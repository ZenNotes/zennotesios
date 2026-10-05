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

    func testCloudSettingsOpenThroughTheMoreSheet() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.windows.firstMatch.waitForExistence(timeout: 10))
        guard app.windows.firstMatch.frame.width < 768 else {
            throw XCTSkip("phone shell only: the iPad runs the desktop layout, which has no ensō menu")
        }

        try openCloudSettings(in: app)

        let screen = ["Connect ZenNotes Cloud", "Cancel sign-in", "Disconnect"]
            .map { element(label: $0, in: app) }
        let deadline = Date().addingTimeInterval(10)
        while !screen.contains(where: \.exists) && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        }
        XCTAssertTrue(screen.contains(where: \.exists), "Settings › Cloud did not open from the ••• sheet")
    }

    func testIPadCanOpenRemoteVaultManagerFromSettings() throws {
        let app = XCUIApplication()
        app.launch()

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
        let app = XCUIApplication()
        app.launch()

        try ensureLinkedCloudVault(in: app, account: account, linkLabel: "Create and link")

        let syncNow = element(label: "Sync now", in: app)
        scrollUntilHittable(syncNow, in: app)
        syncNow.tap()

        let syncComplete = element(label: "Everything is up to date.", in: app)
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
        let app = XCUIApplication()
        app.launch()

        try ensureLinkedCloudVault(in: app, account: account)

        let syncNow = element(label: "Sync now", in: app)
        scrollUntilHittable(syncNow, in: app)
        syncNow.tap()

        let syncComplete = element(label: "Everything is up to date.", in: app)
        XCTAssertTrue(syncComplete.waitForExistence(timeout: 30))

        let done = element(label: "Done", in: app)
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        done.tap()

        try openBrowse(in: app)

        let syncedNote = hittableButton(label: "Desktop to mobile — live sync", in: app)
        XCTAssertTrue(syncedNote.waitForExistence(timeout: 10))
        scrollUntilHittable(syncedNote, in: app)
        syncedNote.tap()

        let syncedBody = element(label: "Created on the desktop app.", in: app)
        XCTAssertTrue(syncedBody.waitForExistence(timeout: 10))

        try openBrowse(in: app)

        let androidNote = hittableButton(label: "Meeting notes — product sync", in: app)
        XCTAssertTrue(androidNote.waitForExistence(timeout: 10))
        scrollUntilHittable(androidNote, in: app)
        androidNote.tap()

        let androidBody = element(label: "Launch window confirmed for next week", in: app)
        XCTAssertTrue(androidBody.waitForExistence(timeout: 10))
    }

    func testAutomaticCloudSyncPullsDesktopAndAndroidChanges() throws {
        let account = try cloudAccount()
        let app = XCUIApplication()
        app.launch()

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
        let app = XCUIApplication()
        app.launch()

        try ensureLinkedCloudVault(in: app, account: account)

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

        titleInput.tap()
        titleInput.typeText("\(proofTitle)\n")
        app.typeText("# \(proofTitle)\n\nExpected path: iPhone -> Laravel -> Electron + Android.\n")

        print("IOS_AUTOSYNC_PROOF_TITLE=\(proofTitle)")

        // The edit must trigger an automatic push: back on the Cloud screen,
        // the status only reads up to date after a successful sync run.
        try openCloudSettings(in: app)
        let pushed = element(label: "Everything is up to date.", in: app)
        XCTAssertTrue(pushed.waitForExistence(timeout: 90))
    }

    func testPublishesExistingNote() throws {
        let account = try cloudAccount()
        let app = XCUIApplication()
        app.launch()

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

        let success = element(label: "Public note updated. Link copied.", in: app)
        XCTAssertTrue(success.waitForExistence(timeout: 15))
    }

    func testPublishesNoteWithSyncedAttachment() throws {
        let account = try cloudAccount()
        let app = XCUIApplication()
        app.launch()

        try ensureLinkedCloudVault(in: app, account: account)

        let syncNow = element(label: "Sync now", in: app)
        scrollUntilHittable(syncNow, in: app)
        syncNow.tap()

        let syncComplete = element(label: "Everything is up to date.", in: app)
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

        let success = element(label: "Public note updated. Link copied.", in: app)
        XCTAssertTrue(success.waitForExistence(timeout: 20))
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

    /// Shared prologue: open Settings → Cloud, connect the account if needed,
    /// and make sure the local vault is linked. Returns with the Cloud screen
    /// open and "Sync now" present.
    private func ensureLinkedCloudVault(
        in app: XCUIApplication,
        account: CloudAccount,
        linkLabel: String = "Link selected vault",
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

    private func openCloudSettings(in app: XCUIApplication) throws {
        let openMenu = app.buttons["Open menu"]
        XCTAssertTrue(openMenu.waitForExistence(timeout: 10))
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
            email.typeText(account.email)

            let password = safari.secureTextFields["Password"]
            XCTAssertTrue(password.waitForExistence(timeout: 3))
            email.typeText("\t")
            password.typeText("\(account.password)\n")
        }

        let authorize = element(label: "Authorize", in: safari)
        XCTAssertTrue(authorize.waitForExistence(timeout: 10))
        authorize.tap()

        let safariOpen = safari.buttons["Open"]
        XCTAssertTrue(safariOpen.waitForExistence(timeout: 5))
        safariOpen.tap()

        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        XCTAssertTrue(disconnect.waitForExistence(timeout: 15))
    }

    private func openBrowse(in app: XCUIApplication) throws {
        let openMenu = app.buttons["Open menu"]
        XCTAssertTrue(openMenu.waitForExistence(timeout: 5))
        openMenu.tap()

        try hittable(label: "Browse", in: app, failure: "the ensō menu did not open").tap()
    }

    private func scrollUntilHittable(_ element: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<8 where !element.isHittable {
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
            if candidate.isHittable {
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
            for index in 0..<matches.count where matches.element(boundBy: index).isHittable {
                return matches.element(boundBy: index)
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        } while Date() < deadline
        return nil
    }
}
