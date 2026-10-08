import XCTest

/// The account-backed flows sign in to ZenNotes Cloud as the dedicated E2E
/// account and read notes its vault already holds (the desktop and Android
/// sync proofs), so no other account can pass them. Without that account's
/// ZENNOTES_CLOUD_E2E_EMAIL and ZENNOTES_CLOUD_E2E_PASSWORD they skip instead
/// of failing, so the whole class can run in the release gate; xcodebuild
/// hands this runner any variable prefixed TEST_RUNNER_ with the prefix
/// removed. The route into Cloud settings needs no account and runs anyway.
///
/// Taps that go through the ensō menu and the ••• sheet look for the match
/// that can take the tap, not the first one: WebKit exposes the whole open
/// note, and the welcome note's bold "More", "Settings" and "Browse" sit
/// earlier in the tree than the controls with those labels. With the menu
/// open, the first "More" was the note's, under the menu's backdrop at
/// x=51, so the tap missed and every Cloud flow failed before reaching Cloud.
final class CloudFlowUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    /// The runner stops xcodebuild when it hangs after a failed run, which leaves the result
    /// bundle (and its screenshots) incomplete, so every failure first prints what is on
    /// screen. Only button and static-text labels: never a field's value. It reads one
    /// snapshot, which throws instead of recording a failure, and runs once per failure:
    /// querying elements here once recorded failures of its own and recursed for minutes.
    private var printingScreen = false

    override func record(_ issue: XCTIssue) {
        if !printingScreen {
            printingScreen = true
            defer { printingScreen = false }
            let targets = [("ZenNotes", XCUIApplication()), ("Safari", XCUIApplication(bundleIdentifier: "com.apple.mobilesafari"))]
            for (name, target) in targets where target.state == .runningForeground {
                guard let root = try? target.snapshot() else { continue }
                var buttons: [String] = []
                var texts: [String] = []
                collectLabels(root, buttons: &buttons, texts: &texts)
                print("SCREEN \(name) | buttons: \(buttons) | texts: \(texts)")
            }
        }
        super.record(issue)
    }

    private func collectLabels(_ node: XCUIElementSnapshot, buttons: inout [String], texts: inout [String]) {
        if !node.label.isEmpty {
            if node.elementType == .button, buttons.count < 25 {
                buttons.append(node.label)
            } else if node.elementType == .staticText, texts.count < 25 {
                texts.append(node.label)
            }
        }
        for child in node.children where buttons.count < 25 || texts.count < 25 {
            collectLabels(child, buttons: &buttons, texts: &texts)
        }
    }

    func testCloudSettingsOpenThroughTheMoreSheet() throws {
        let app = launchApp()
        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 10))
        guard app.windows.firstMatch.frame.width < 768 else {
            throw XCTSkip("phone shell only: the iPad runs the desktop layout, which has no ensō menu")
        }

        try openCloudSettings(in: app, viaMenu: true)

        let screen = ["Connect ZenNotes Cloud", "Cancel sign-in", "Disconnect"]
            .map { element(label: $0, in: app) }
        let deadline = Date().addingTimeInterval(10)
        while !screen.contains(where: \.exists) && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        }
        XCTAssertTrue(screen.contains(where: \.exists), "Settings › Cloud did not open from the ••• sheet")
    }

    func testIPadCanOpenRemoteVaultManagerFromSettings() throws {
        let app = launchApp()

        let appWindow = app.windows.firstMatch
        XCTAssertTrue(appWindow.waitForExistence(timeout: 5))
        guard appWindow.frame.width >= 768 else {
            throw XCTSkip("iPad-only remote-vault regression coverage")
        }

        let settings = element(label: "Settings", in: app)
        XCTAssertTrue(settings.waitForExistence(timeout: 10))
        settings.tap()

        let vault = element(label: "Vault", in: app)
        XCTAssertTrue(vault.waitForExistence(timeout: 5))
        vault.tap()

        let manage = element(label: "Manage…", in: app)
        XCTAssertTrue(manage.waitForExistence(timeout: 5))
        manage.tap()

        let addRemoteVault = element(label: "Add Remote Vault…", in: app)
        XCTAssertTrue(addRemoteVault.waitForExistence(timeout: 5))
    }

    func testCloudSyncAndBackupFlow() throws {
        let account = try cloudAccount()
        let app = launchApp()

        try ensureLinkedCloudVault(in: app, account: account)

        let syncNow = element(label: "Sync now", in: app)
        scrollUntilHittable(syncNow, in: app)
        syncNow.tap()

        let syncComplete = element(label: "All changes are synced.", in: app)
        XCTAssertTrue(syncComplete.waitForExistence(timeout: 30))

        let createBackup = element(label: "Create backup", in: app)
        XCTAssertTrue(createBackup.waitForExistence(timeout: 5))
        scrollUntilHittable(createBackup, in: app)
        createBackup.tap()

        let ready = element(label: "Ready", in: app)
        XCTAssertTrue(ready.waitForExistence(timeout: 60))
    }

    func testDesktopNoteAppearsAfterSync() throws {
        let account = try cloudAccount()
        let app = launchApp()

        try ensureLinkedCloudVault(in: app, account: account)

        let syncNow = element(label: "Sync now", in: app)
        scrollUntilHittable(syncNow, in: app)
        syncNow.tap()

        let syncComplete = element(label: "All changes are synced.", in: app)
        XCTAssertTrue(syncComplete.waitForExistence(timeout: 30))

        let done = element(label: "Done", in: app)
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        done.tap()

        try openBrowse(in: app)

        let syncedNote = hittableButton(label: "Desktop to mobile - live sync", in: app)
        XCTAssertTrue(syncedNote.waitForExistence(timeout: 10))
        scrollUntilHittable(syncedNote, in: app)
        syncedNote.tap()

        let syncedBody = element(label: "Created on the desktop app.", in: app)
        XCTAssertTrue(syncedBody.waitForExistence(timeout: 10))

        try openBrowse(in: app)

        let androidNote = hittableButton(label: "Meeting notes - product sync", in: app)
        XCTAssertTrue(androidNote.waitForExistence(timeout: 10))
        scrollUntilHittable(androidNote, in: app)
        androidNote.tap()

        let androidBody = element(label: "Launch window confirmed for next week", in: app)
        XCTAssertTrue(androidBody.waitForExistence(timeout: 10))
    }

    func testAutomaticCloudSyncPullsDesktopAndAndroidChanges() throws {
        let account = try cloudAccount()
        let app = launchApp()

        try ensureLinkedCloudVault(in: app, account: account, forceReconnect: true)

        let done = element(label: "Done", in: app)
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        done.tap()

        try openBrowse(in: app)

        let desktopProof = hittableButton(label: "Automatic sync proof - desktop", in: app)
        XCTAssertTrue(desktopProof.waitForExistence(timeout: 60))

        let androidProof = hittableButton(label: "Automatic sync proof - Android", in: app)
        XCTAssertTrue(androidProof.waitForExistence(timeout: 60))
    }

    func testAutomaticCloudSyncPushesIOSChange() throws {
        let account = try cloudAccount()
        let app = launchApp()

        try ensureLinkedCloudVault(in: app, account: account)
        let filesBefore = try XCTUnwrap(syncedFileCount(in: app), "the Cloud screen shows no synced file count")

        let done = element(label: "Done", in: app)
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        done.tap()

        let openMenu = app.buttons["Open menu"]
        XCTAssertTrue(openMenu.waitForExistence(timeout: 10))
        openMenu.tap()

        try hittable(label: "New", in: app, failure: "the ensō menu did not open").tap()
        try hittable(label: "New note", in: app, failure: "the New sheet has no New note row").tap()

        let titleInput = app.textFields["Untitled"]
        XCTAssertTrue(titleInput.waitForExistence(timeout: 10))

        let suffix = String(Int(Date().timeIntervalSince1970))
        let proofTitle = "Automatic sync proof - iPhone \(suffix)"

        // The field opens holding the text Untitled, not a placeholder, so select it all
        // and type over it.
        titleInput.tap(withNumberOfTaps: 3, numberOfTouches: 1)
        titleInput.typeText("\(proofTitle)\n")
        app.typeText("# \(proofTitle)\n\nExpected path: iPhone -> Laravel -> Electron + Android.\n")

        print("IOS_AUTOSYNC_PROOF_TITLE=\(proofTitle)")

        // The ensō menu hides while the keyboard is up.
        try hittable(label: "Dismiss keyboard", in: app, failure: "the editor toolbar has no Dismiss keyboard").tap()

        // The edit must reach the server on its own. The status card only shows the last
        // run (a later no-op run replaces an upload's summary), so the proof is the storage
        // card's count of the files the server holds, read each time the screen opens.
        let deadline = Date().addingTimeInterval(90)
        var filesAfter = filesBefore
        repeat {
            try openCloudSettings(in: app)
            filesAfter = syncedFileCount(in: app) ?? filesBefore
            if filesAfter > filesBefore {
                break
            }
            element(label: "Done", in: app).tap()
            RunLoop.current.run(until: Date().addingTimeInterval(10))
        } while Date() < deadline
        XCTAssertGreaterThan(filesAfter, filesBefore, "the new note never reached the server")
    }

    func testPublishesExistingNote() throws {
        let account = try cloudAccount()
        let app = launchApp()

        try ensureLinkedCloudVault(in: app, account: account)

        let done = element(label: "Done", in: app)
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        done.tap()

        try openBrowse(in: app)

        let note = hittableButton(label: "Automatic sync proof - desktop", in: app)
        XCTAssertTrue(note.waitForExistence(timeout: 10))
        scrollUntilHittable(note, in: app)
        note.tap()

        let openMenu = app.buttons["Open menu"]
        XCTAssertTrue(openMenu.waitForExistence(timeout: 5))
        openMenu.tap()

        try hittable(label: "Publish", in: app, failure: "the ensō menu has no Publish item").tap()
        confirmPublish(in: app, timeout: 30)
    }

    func testPublishesNoteWithSyncedAttachment() throws {
        let account = try cloudAccount()
        let app = launchApp()

        try ensureLinkedCloudVault(in: app, account: account)

        let syncNow = element(label: "Sync now", in: app)
        scrollUntilHittable(syncNow, in: app)
        syncNow.tap()

        let syncComplete = element(label: "All changes are synced.", in: app)
        XCTAssertTrue(syncComplete.waitForExistence(timeout: 30))

        let done = element(label: "Done", in: app)
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        done.tap()

        try openBrowse(in: app)

        let note = hittableButton(label: "Cloud attachment publishing proof", in: app)
        XCTAssertTrue(note.waitForExistence(timeout: 15))
        scrollUntilHittable(note, in: app)
        note.tap()

        let openMenu = app.buttons["Open menu"]
        XCTAssertTrue(openMenu.waitForExistence(timeout: 5))
        openMenu.tap()

        try hittable(label: "Publish", in: app, failure: "the ensō menu has no Publish item").tap()
        confirmPublish(in: app, timeout: 30)
    }

    private struct CloudAccount {
        let email: String
        let password: String
    }

    /// The E2E account's credentials, or a skip naming what is missing. Asked
    /// before launch, so a run without them costs nothing.
    private func cloudAccount() throws -> CloudAccount {
        let environment = ProcessInfo.processInfo.environment
        let email = environment["ZENNOTES_CLOUD_E2E_EMAIL"] ?? ""
        let password = environment["ZENNOTES_CLOUD_E2E_PASSWORD"] ?? ""
        let missing = [("ZENNOTES_CLOUD_E2E_EMAIL", email), ("ZENNOTES_CLOUD_E2E_PASSWORD", password)]
            .filter { $0.1.isEmpty }
            .map(\.0)
        guard missing.isEmpty else {
            throw XCTSkip(
                "Cloud flow needs the ZenNotes Cloud E2E account: \(missing.joined(separator: " and ")) not set. "
                    + "Pass TEST_RUNNER_ZENNOTES_CLOUD_E2E_EMAIL and TEST_RUNNER_ZENNOTES_CLOUD_E2E_PASSWORD to xcodebuild."
            )
        }
        return CloudAccount(email: email, password: password)
    }

    /// Launches the app past first-run onboarding. A fresh install (the Cloud runner
    /// erases its simulator every run) opens on Get started and a storage choice,
    /// neither of which has the ensō menu; notes kept on the device need no iCloud
    /// account, which the simulator lacks. Waits for whichever screen comes first,
    /// so an installed app pays no fixed delay.
    private func launchApp() -> XCUIApplication {
        let app = XCUIApplication()
        let getStarted = app.buttons["Get started"]
        let mainScreen = [app.buttons["Open menu"], element(label: "Settings", in: app)]

        // On a busy Mac the first launch after an erase has left the web view empty for
        // more than half a minute, so the wait is long and a still-blank app is relaunched.
        for attempt in 1...2 {
            app.launch()
            if waitForAny([getStarted] + mainScreen, timeout: attempt == 1 ? 45 : 30) {
                break
            }
            app.terminate()
        }

        if getStarted.exists {
            getStarted.tap()
            let onDevice = app.buttons
                .matching(NSPredicate(format: "label BEGINSWITH %@", "On this "))
                .firstMatch
            XCTAssertTrue(onDevice.waitForExistence(timeout: 5), "onboarding has no on-device storage choice")
            onDevice.tap()
            XCTAssertTrue(waitForAny(mainScreen, timeout: 30), "the app never showed its main screen after onboarding")
        }
        return app
    }

    private func waitForAny(_ elements: [XCUIElement], timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while !elements.contains(where: \.exists) && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        return elements.contains(where: \.exists)
    }

    /// Shared prologue: open Settings → Cloud, connect the account if needed,
    /// and make sure the local vault is linked. Returns with the Cloud screen
    /// open and "Sync now" present.
    private func ensureLinkedCloudVault(
        in app: XCUIApplication,
        account: CloudAccount,
        linkLabel: String = "Open on this device",
        forceReconnect: Bool = false
    ) throws {
        try openCloudSettings(in: app)
        connectCloudAccountIfNeeded(in: app, account: account, forceReconnect: forceReconnect)

        let syncNow = element(label: "Sync now", in: app)
        if !syncNow.waitForExistence(timeout: 5) {
            let link = element(label: linkLabel, in: app)
            XCTAssertTrue(link.waitForExistence(timeout: 5))
            scrollUntilHittable(link, in: app)
            link.tap()
        }

        XCTAssertTrue(syncNow.waitForExistence(timeout: 15))
    }

    private func openCloudSettings(in app: XCUIApplication, viaMenu: Bool = false) throws {
        // A test that stopped mid-sign-in can leave the app reopening on Settings, over
        // the menu; carry on from there unless the route itself is under test.
        if !viaMenu, ["Connect ZenNotes Cloud", "Cancel sign-in", "Disconnect"].contains(where: { element(label: $0, in: app).exists }) {
            return
        }
        let openMenu = app.buttons["Open menu"]
        if !viaMenu, !openMenu.waitForExistence(timeout: 3) {
            if let cloud = hittableMatch(NSPredicate(format: "label == %@", "Cloud"), in: app, timeout: 2) {
                cloud.tap()
                return
            }
            let done = element(label: "Done", in: app)
            if done.exists {
                done.tap()
            }
        }
        XCTAssertTrue(openMenu.waitForExistence(timeout: 20), "the ensō menu never appeared")
        openMenu.tap()

        try hittable(label: "More", in: app, failure: "the ensō menu did not open").tap()
        try hittable(label: "Settings", in: app, failure: "the ••• sheet has no Settings row").tap()
        try hittable(label: "Cloud", in: app, failure: "Settings has no Cloud section").tap()
    }

    private func connectCloudAccountIfNeeded(
        in app: XCUIApplication,
        account: CloudAccount,
        forceReconnect: Bool = false
    ) {
        let connect = element(label: "Connect ZenNotes Cloud", in: app)
        let disconnect = element(label: "Disconnect", in: app)
        let cancelSignIn = element(label: "Cancel sign-in", in: app)

        if cancelSignIn.waitForExistence(timeout: 2) {
            cancelSignIn.tap()
            XCTAssertTrue(connect.waitForExistence(timeout: 5))
        }

        if disconnect.waitForExistence(timeout: 5), forceReconnect {
            disconnect.tap()
            XCTAssertTrue(connect.waitForExistence(timeout: 5))
        } else if disconnect.exists {
            return
        }

        XCTAssertTrue(connect.exists)
        connect.tap()

        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 10))

        let email = element(label: "Email address", in: safari)
        if email.waitForExistence(timeout: 10) {
            email.tap()
            typeChecked(account.email, into: email, secure: false)

            let password = safari.secureTextFields["Password"]
            XCTAssertTrue(password.waitForExistence(timeout: 3))
            email.typeText("\t")
            typeChecked(account.password, into: password, secure: true)
            password.typeText("\n")
        }

        // Safari offers to save the password as the sign-in lands, before or after the
        // Authorize page shows, and the alert hides the page until it is answered.
        let authorize = element(label: "Authorize", in: safari)
        let notNow = safari.buttons["Not Now"]
        let deadline = Date().addingTimeInterval(20)
        while !authorize.exists && Date() < deadline {
            if notNow.exists {
                notNow.tap()
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        }
        XCTAssertTrue(authorize.exists, "the sign-in never reached the Authorize page")
        if notNow.waitForExistence(timeout: 2) {
            notNow.tap()
        }
        authorize.tap()

        let safariOpen = safari.buttons["Open"]
        XCTAssertTrue(safariOpen.waitForExistence(timeout: 15), "Safari never offered to open ZenNotes after Authorize")
        safariOpen.tap()

        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        XCTAssertTrue(disconnect.waitForExistence(timeout: 15))
    }

    /// The Cloud screen's storage card counts the files the server holds for the account.
    private func syncedFileCount(in app: XCUIApplication) -> Int? {
        let line = app.staticTexts
            .matching(NSPredicate(format: "label MATCHES %@", "[0-9]+ synced files? across .*"))
            .firstMatch
        guard line.waitForExistence(timeout: 10) else { return nil }
        return Int(line.label.prefix { $0.isNumber })
    }

    /// Types into a sign-in field and checks what landed: the first typing on a freshly
    /// erased simulator has dropped characters, and the sign-in then failed as wrong
    /// credentials. A secure field only reads back dots, so it is checked by length.
    private func typeChecked(_ text: String, into field: XCUIElement, secure: Bool) {
        for attempt in 1...3 {
            if attempt == 1 {
                field.typeText(text)
            } else {
                let held = (field.value as? String) ?? ""
                let count = held == field.placeholderValue ? 0 : held.count
                field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: count + 2))
                for character in text {
                    field.typeText(String(character))
                }
            }
            let landed = (field.value as? String) ?? ""
            let holdsText = !landed.isEmpty && landed != field.placeholderValue
            if holdsText, secure ? landed.count == text.count : landed == text {
                return
            }
        }
        XCTFail("a sign-in field never held what was typed")
    }

    /// The menu's Publish opens a dialog whose button reads Publish note the first time
    /// and Update note once the note is public. The dialog closes only once the publish is
    /// confirmed (a toast says so, briefly); a failure keeps it open with the reason.
    private func confirmPublish(in app: XCUIApplication, timeout: TimeInterval) {
        let confirm = app.buttons
            .matching(NSPredicate(format: "label IN %@", ["Publish note", "Update note"]))
            .firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 10), "the Publish dialog never opened")
        let enabledBy = Date().addingTimeInterval(10)
        while !confirm.isEnabled && Date() < enabledBy {
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        }
        confirm.tap()

        let dialogOpen = app.buttons
            .matching(NSPredicate(format: "label IN %@", ["Publish note", "Update note", "Publishing…"]))
            .firstMatch
        let published = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label IN %@", ["Note published. Link copied.", "Public note updated. Link copied."]))
            .firstMatch
        let deadline = Date().addingTimeInterval(timeout)
        while dialogOpen.exists && !published.exists && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        }
        XCTAssertTrue(published.exists || !dialogOpen.exists, "the note was not published")
    }

    private func openBrowse(in app: XCUIApplication) throws {
        let openMenu = app.buttons["Open menu"]
        XCTAssertTrue(openMenu.waitForExistence(timeout: 5))
        openMenu.tap()

        try hittable(label: "Browse", in: app, failure: "the ensō menu did not open").tap()
    }

    /// Long note lists render rows only near the screen, and a row further down is a
    /// placeholder with an empty frame whose hittability XCTest cannot work out (it
    /// records a failure instead of answering), so such a row counts as not yet tappable.
    private func canTap(_ element: XCUIElement) -> Bool {
        element.exists && !element.frame.isEmpty && element.isHittable
    }

    private func scrollUntilHittable(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<8 where !canTap(element) {
            app.swipeUp()
        }
    }

    private func element(label: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", label))
            .firstMatch
    }

    private func hittableButton(label: String, in app: XCUIApplication) -> XCUIElement {
        let matches = app.buttons.matching(NSPredicate(format: "label == %@", label))
        for index in 0..<matches.count {
            let candidate = matches.element(boundBy: index)
            if canTap(candidate) {
                return candidate
            }
        }

        return matches.element(boundBy: max(matches.count - 1, 0))
    }

    /// Any element type: the ensō menu's items are role=menuitem.
    private func hittable(
        label: String,
        in app: XCUIApplication,
        failure: @autoclosure () -> String
    ) throws -> XCUIElement {
        try XCTUnwrap(hittableMatch(NSPredicate(format: "label == %@", label), in: app), failure())
    }

    /// Polls for a match that is on screen and tappable: the menu and the
    /// sheets mount a moment after the tap that opens them, and note text
    /// under their backdrop must not win.
    private func hittableMatch(
        _ predicate: NSPredicate,
        in app: XCUIApplication,
        timeout: TimeInterval = 10
    ) -> XCUIElement? {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            let matches = app.descendants(matching: .any).matching(predicate)
            for index in 0..<matches.count where canTap(matches.element(boundBy: index)) {
                return matches.element(boundBy: index)
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        } while Date() < deadline
        return nil
    }
}
