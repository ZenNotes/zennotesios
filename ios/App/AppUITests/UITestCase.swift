import ObjectiveC
import XCTest

/// Base class of every UI test in this target. All it adds is the bound on XCTest's
/// animation wait below, installed once before the first test runs.
class UITestCase: XCTestCase {
    override class func setUp() {
        super.setUp()
        AnimationIdleBound.install()
    }
}

/// XCTest waits for the app to go idle before and after every tap and every typed
/// string: first for the main run loop, then for the app to say its animations are
/// done. On the iOS 27.2 simulator that second report can stop arriving for the rest
/// of a process's life. It was seen in ZenNotes after Dismiss keyboard and after a tap
/// in the ensō menu, and in Safari after the Save Password sheet, so it is not this
/// app's code, and the app keeps working: only the report is missing. XCTest then
/// waits its full 60 seconds at each step ("App animations complete notification not
/// received, will attempt to continue."). A Cloud test that takes 31 seconds took
/// nine and a half minutes, and a sign-in outlasted the five-minute device approval.
///
/// XCTest has no public setting for this wait, so its one entry point is replaced:
/// every event, launch and activation reaches the app through
/// -[XCUIApplicationProcess waitForQuiescenceIncludingAnimationsIdle:isPreEvent:].
/// The replacement still runs the original, once, exactly as XCTest would, so the
/// timing of a healthy app does not change; the wait only may not last longer than
/// `firstLimit`. Measured on this simulator, a healthy wait after an event takes under
/// half a second and the one after launch a second and a half.
///
/// A process that used up the limit once is one that has stopped reporting. From then
/// on its wait runs in two steps: the run loop step under XCTest's own timeout, then
/// the animations step for at most `stalledLimit`, still longer than any keyboard,
/// sheet or app-switch animation these tests meet. Nothing a test asserts changes.
///
/// Giving up on one wait does not disturb the next: with a three-second animation
/// running, the waits inside it were cut short and the waits after it returned at once.
///
/// These are private names. If a later Xcode renames any of them the bound is not
/// installed, a line starting IDLE_BOUND says so in the test output, and the tests run
/// as XCTest ships them.
enum AnimationIdleBound {
    static let firstLimit: TimeInterval = 5
    static let stalledLimit: TimeInterval = 1

    private static var installed = false
    /// The processes that have used up a limit. Held weakly: XCTest makes a new process
    /// object for every launch, and a relaunched app starts with the first limit again.
    private static let stalled = NSHashTable<AnyObject>.weakObjects()

    static func install() {
        guard !installed else { return }
        installed = true

        let selector = NSSelectorFromString("waitForQuiescenceIncludingAnimationsIdle:isPreEvent:")
        guard
            let processClass = NSClassFromString("XCUIApplicationProcess"),
            let method = class_getInstanceMethod(processClass, selector)
        else {
            return unavailable("XCUIApplicationProcess has no \(selector)")
        }
        // self, _cmd and two BOOLs (B on Apple silicon, c on an Intel Mac's simulator).
        let encoding = method_getTypeEncoding(method).map { String(cString: $0) } ?? ""
        guard encoding.range(of: "^v[0-9]+@0:8[Bc][0-9]+[Bc][0-9]+$", options: .regularExpression) != nil else {
            return unavailable("\(selector) changed shape (\(encoding))")
        }
        guard
            let image = dlopen(nil, RTLD_NOW),
            let readSymbol = dlsym(image, "_XCTApplicationStateTimeout"),
            let writeSymbol = dlsym(image, "_XCTSetApplicationStateTimeout")
        else {
            return unavailable("XCTest exports no application state timeout")
        }

        typealias Wait = @convention(c) (AnyObject, Selector, ObjCBool, ObjCBool) -> Void
        let wait = unsafeBitCast(method_getImplementation(method), to: Wait.self)
        let timeout = unsafeBitCast(readSymbol, to: (@convention(c) () -> Double).self)
        let setTimeout = unsafeBitCast(writeSymbol, to: (@convention(c) (Double) -> Void).self)

        let bounded: @convention(block) (AnyObject, ObjCBool, ObjCBool) -> Void = { process, animations, preEvent in
            guard animations.boolValue else {
                return wait(process, selector, false, preEvent)
            }
            // The timeout is XCTest's one number for every app state change, launches
            // included, so it is lowered for one call at a time and put back.
            let usual = timeout()
            let limit: TimeInterval
            if stalled.contains(process) {
                wait(process, selector, false, preEvent)
                limit = min(usual, stalledLimit)
            } else {
                limit = min(usual, firstLimit)
            }
            setTimeout(limit)
            defer { setTimeout(usual) }
            let began = Date()
            wait(process, selector, true, preEvent)
            if Date().timeIntervalSince(began) >= limit {
                stalled.add(process)
            }
        }
        method_setImplementation(method, imp_implementationWithBlock(bounded))
    }

    private static func unavailable(_ reason: String) {
        print("IDLE_BOUND not installed: \(reason). On a simulator that never reports its animations done, each step will wait 60 seconds.")
    }
}
