import XCTest

/// `zennotes://` links reach the WebView through SceneDelegate (the scene
/// life cycle routes URL opens there, never to AppDelegate). A widget tap
/// while the app runs arrives as `scene(_:openURLContexts:)`; a tap that
/// launches the app arrives in the connection options and is held until the
/// bridge view has appeared. Both must end in `note.new.inbox` running, so
/// the proof is a note name of the form "Untitled" / "Untitled N" that was
/// not on screen before the link — whatever the layout: the phone shell
/// shows it in the title field, the iPad's desktop layout in a tab and the
/// breadcrumb (regression for #26).
final class DeepLinkUITests: XCTestCase {
    private let newNoteLink = URL(string: "zennotes://new")!
    private let untitledPattern = "^Untitled( \\d+)?$"

    override func setUpWithError() throws {
        continueAfterFailure = false
        // A confirmation left over from an earlier run would swallow the tap.
        let stale = springboard.buttons["Cancel"]
        if stale.exists {
            stale.tap()
        }
    }

    private var springboard: XCUIApplication {
        XCUIApplication(bundleIdentifier: "com.apple.springboard")
    }

    func testWarmLinkOpensNewNote() throws {
        let app = XCUIApplication()
        app.launch()
        let before = settledUntitledNames(in: app)

        open(newNoteLink)

        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        XCTAssertNotNil(
            waitForNewUntitledName(in: app, notIn: before, timeout: 20),
            "no new untitled note appeared after zennotes://new (on screen before: \(before.sorted()))"
        )
    }

    func testColdLaunchLinkOpensNewNote() throws {
        // The workspace restore reopens the last note, so what is on screen
        // after a plain launch is exactly what the cold link launch will show
        // before the link runs.
        let app = XCUIApplication()
        app.launch()
        let before = settledUntitledNames(in: app)
        app.terminate()
        XCTAssertTrue(app.wait(for: .notRunning, timeout: 10))

        open(newNoteLink)

        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30))
        XCTAssertNotNil(
            waitForNewUntitledName(in: app, notIn: before, timeout: 40),
            "no new untitled note appeared after a cold zennotes://new launch (on screen before: \(before.sorted()))"
        )
    }

    /// Opens the link the way a widget tap does; the simulator may first ask
    /// "Open in ZenNotes?", which a real widget tap never does.
    private func open(_ url: URL) {
        XCUIDevice.shared.system.open(url)
        let confirm = springboard.buttons["Open"]
        if confirm.waitForExistence(timeout: 3) {
            confirm.tap()
        }
    }

    /// Every "Untitled" / "Untitled N" currently on screen: element labels
    /// (tabs, breadcrumbs, list rows) plus text field values (the phone title
    /// field is labelled "Untitled" and carries the name as its value).
    private func untitledNames(in app: XCUIApplication) -> Set<String> {
        let labelled = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label MATCHES %@", untitledPattern))
        var names = Set(labelled.allElementsBoundByIndex.map(\.label))
        for field in app.textFields.allElementsBoundByIndex {
            if let value = field.value as? String, value.range(of: untitledPattern, options: .regularExpression) != nil {
                names.insert(value)
            }
        }
        return names
    }

    /// Waits for the WebView to render and the workspace restore to finish:
    /// the set of untitled names on screen has to hold still for three
    /// seconds. Restoring reopens the last note, which may itself be untitled.
    private func settledUntitledNames(in app: XCUIApplication, timeout: TimeInterval = 40) -> Set<String> {
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: timeout))
        let deadline = Date().addingTimeInterval(timeout)
        var names = untitledNames(in: app)
        var stableSince = Date()
        while Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(1))
            let now = untitledNames(in: app)
            if now != names {
                names = now
                stableSince = Date()
            } else if Date().timeIntervalSince(stableSince) >= 3, app.staticTexts.firstMatch.exists {
                return names
            }
        }
        return names
    }

    private func waitForNewUntitledName(in app: XCUIApplication, notIn before: Set<String>, timeout: TimeInterval) -> String? {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let name = untitledNames(in: app).subtracting(before).first {
                return name
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        return nil
    }
}
