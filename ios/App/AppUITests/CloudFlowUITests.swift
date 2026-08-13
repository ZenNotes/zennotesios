import XCTest

final class CloudFlowUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testCloudSyncAndBackupFlow() throws {
        let app = XCUIApplication()
        app.launch()

        ensureLinkedCloudVault(in: app, linkLabel: "Create and link")

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
        let app = XCUIApplication()
        app.launch()

        ensureLinkedCloudVault(in: app)

        let syncNow = element(label: "Sync now", in: app)
        scrollUntilHittable(syncNow, in: app)
        syncNow.tap()

        let syncComplete = element(label: "Everything is up to date.", in: app)
        XCTAssertTrue(syncComplete.waitForExistence(timeout: 30))

        let done = element(label: "Done", in: app)
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        done.tap()

        let openMenu = app.buttons["Open menu"]
        XCTAssertTrue(openMenu.waitForExistence(timeout: 5))
        openMenu.tap()

        let browse = element(label: "Browse", in: app)
        XCTAssertTrue(browse.waitForExistence(timeout: 5))
        browse.tap()

        let syncedNote = hittableButton(label: "Desktop to mobile — live sync", in: app)
        XCTAssertTrue(syncedNote.waitForExistence(timeout: 10))
        scrollUntilHittable(syncedNote, in: app)
        syncedNote.tap()

        let syncedBody = element(label: "Created on the desktop app.", in: app)
        XCTAssertTrue(syncedBody.waitForExistence(timeout: 10))

        openMenu.tap()
        XCTAssertTrue(browse.waitForExistence(timeout: 5))
        browse.tap()

        let androidNote = hittableButton(label: "Meeting notes — product sync", in: app)
        XCTAssertTrue(androidNote.waitForExistence(timeout: 10))
        scrollUntilHittable(androidNote, in: app)
        androidNote.tap()

        let androidBody = element(label: "Launch window confirmed for next week", in: app)
        XCTAssertTrue(androidBody.waitForExistence(timeout: 10))
    }

    func testAutomaticCloudSyncPullsDesktopAndAndroidChanges() throws {
        let app = XCUIApplication()
        app.launch()

        ensureLinkedCloudVault(in: app, forceReconnect: true)

        let done = element(label: "Done", in: app)
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        done.tap()

        openBrowse(in: app)

        let desktopProof = hittableButton(label: "Automatic sync proof - desktop", in: app)
        XCTAssertTrue(desktopProof.waitForExistence(timeout: 60))

        let androidProof = hittableButton(label: "Automatic sync proof - Android", in: app)
        XCTAssertTrue(androidProof.waitForExistence(timeout: 60))
    }

    func testAutomaticCloudSyncPushesIOSChange() throws {
        let app = XCUIApplication()
        app.launch()

        ensureLinkedCloudVault(in: app)

        let done = element(label: "Done", in: app)
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        done.tap()

        let openMenu = app.buttons["Open menu"]
        XCTAssertTrue(openMenu.waitForExistence(timeout: 10))
        openMenu.tap()

        let new = element(label: "New", in: app)
        XCTAssertTrue(new.waitForExistence(timeout: 5))
        new.tap()

        let newNote = element(label: "New note", in: app)
        XCTAssertTrue(newNote.waitForExistence(timeout: 5))
        newNote.tap()

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
        openCloudSettings(in: app)
        let pushed = element(label: "Everything is up to date.", in: app)
        XCTAssertTrue(pushed.waitForExistence(timeout: 90))
    }

    func testPublishesExistingNote() throws {
        let app = XCUIApplication()
        app.launch()

        ensureLinkedCloudVault(in: app)

        let done = element(label: "Done", in: app)
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        done.tap()

        openBrowse(in: app)

        let note = hittableButton(label: "Automatic sync proof - desktop", in: app)
        XCTAssertTrue(note.waitForExistence(timeout: 10))
        scrollUntilHittable(note, in: app)
        note.tap()

        let openMenu = app.buttons["Open menu"]
        XCTAssertTrue(openMenu.waitForExistence(timeout: 5))
        openMenu.tap()

        let publish = element(label: "Publish", in: app)
        XCTAssertTrue(publish.waitForExistence(timeout: 5))
        publish.tap()

        let success = element(label: "Public note updated. Link copied.", in: app)
        XCTAssertTrue(success.waitForExistence(timeout: 15))
    }

    func testPublishesNoteWithSyncedAttachment() throws {
        let app = XCUIApplication()
        app.launch()

        ensureLinkedCloudVault(in: app)

        let syncNow = element(label: "Sync now", in: app)
        scrollUntilHittable(syncNow, in: app)
        syncNow.tap()

        let syncComplete = element(label: "Everything is up to date.", in: app)
        XCTAssertTrue(syncComplete.waitForExistence(timeout: 30))

        let done = element(label: "Done", in: app)
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        done.tap()

        openBrowse(in: app)

        let note = hittableButton(label: "Cloud attachment publishing proof", in: app)
        XCTAssertTrue(note.waitForExistence(timeout: 15))
        scrollUntilHittable(note, in: app)
        note.tap()

        let openMenu = app.buttons["Open menu"]
        XCTAssertTrue(openMenu.waitForExistence(timeout: 5))
        openMenu.tap()

        let publish = element(label: "Publish", in: app)
        XCTAssertTrue(publish.waitForExistence(timeout: 5))
        publish.tap()

        let success = element(label: "Public note updated. Link copied.", in: app)
        XCTAssertTrue(success.waitForExistence(timeout: 20))
    }

    /// Shared prologue: open Settings → Cloud, connect the account if needed,
    /// and make sure the local vault is linked. Returns with the Cloud screen
    /// open and "Sync now" present.
    private func ensureLinkedCloudVault(
        in app: XCUIApplication,
        linkLabel: String = "Link selected vault",
        forceReconnect: Bool = false
    ) {
        openCloudSettings(in: app)
        connectCloudAccountIfNeeded(in: app, forceReconnect: forceReconnect)

        let syncNow = element(label: "Sync now", in: app)
        if !syncNow.waitForExistence(timeout: 5) {
            let link = element(label: linkLabel, in: app)
            XCTAssertTrue(link.waitForExistence(timeout: 5))
            scrollUntilHittable(link, in: app)
            link.tap()
        }

        XCTAssertTrue(syncNow.waitForExistence(timeout: 15))
    }

    private func openCloudSettings(in app: XCUIApplication) {

        let openMenu = app.buttons["Open menu"]
        XCTAssertTrue(openMenu.waitForExistence(timeout: 10))
        openMenu.tap()

        let more = element(label: "More", in: app)
        XCTAssertTrue(more.waitForExistence(timeout: 3))
        more.tap()

        let settings = element(label: "Settings", in: app)
        XCTAssertTrue(settings.waitForExistence(timeout: 3))
        settings.tap()

        let cloud = element(label: "Cloud", in: app)
        XCTAssertTrue(cloud.waitForExistence(timeout: 3))
        cloud.tap()
    }

    private func connectCloudAccountIfNeeded(in app: XCUIApplication, forceReconnect: Bool = false) {
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
            email.typeText("test@example.com")

            let password = safari.secureTextFields["Password"]
            XCTAssertTrue(password.waitForExistence(timeout: 3))
            email.typeText("\t")
            password.typeText("password\n")
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

    private func openBrowse(in app: XCUIApplication) {
        let openMenu = app.buttons["Open menu"]
        XCTAssertTrue(openMenu.waitForExistence(timeout: 5))
        openMenu.tap()

        let browse = element(label: "Browse", in: app)
        XCTAssertTrue(browse.waitForExistence(timeout: 5))
        browse.tap()
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
}
