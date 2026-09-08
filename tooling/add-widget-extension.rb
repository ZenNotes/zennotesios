# Wires the ZenWidgets WidgetKit extension target into the Capacitor-generated
# Xcode project (Home Screen / Lock Screen widgets, ios/App/ZenWidgets), and
# adds the app-side WidgetBridgePlugin.swift to the App target. Mirrors
# add-share-extension.rb. Idempotent: safe to re-run (skips work that's
# already done). Re-run it if the Xcode project is ever regenerated.
#
# Run with the xcodeproj gem vendored in Homebrew's CocoaPods:
#   GEM_PATH=$(ls -d /opt/homebrew/Cellar/cocoapods/*/libexec | head -1) \
#     ruby tooling/add-widget-extension.rb
require 'xcodeproj'

project_path = File.expand_path('../ios/App/App.xcodeproj', __dir__)
project = Xcodeproj::Project.open(project_path)

app_target = project.targets.find { |t| t.name == 'App' }
raise 'App target not found' unless app_target

TARGET_NAME = 'ZenWidgets'
BUNDLE_ID = 'md.zennotes.ZenWidgets'
# Keep in lockstep with the other nine IPHONEOS_DEPLOYMENT_TARGET sites
# (project + App + ShareExtension + AppUITests, Debug/Release) and the Podfile.
DEPLOYMENT_TARGET = '15.0'
SOURCES = %w[
  ZenWidgetsBundle.swift
  WidgetSnapshot.swift
  WidgetTheme.swift
  NewNoteWidget.swift
  RecentNotesWidget.swift
  TasksWidget.swift
].freeze

# --- App target: the publisher plugin --------------------------------------

app_group = project.main_group['App']
%w[WidgetBridgePlugin.swift].each do |name|
  next if app_group.files.any? { |f| f.display_name == name }
  ref = app_group.new_reference(name)
  app_target.add_file_references([ref])
  puts "added #{name} to App target"
end

# --- ZenWidgets target ------------------------------------------------------

ext_target = project.targets.find { |t| t.name == TARGET_NAME }
if ext_target.nil?
  ext_target = project.new_target(:app_extension, TARGET_NAME, :ios, DEPLOYMENT_TARGET)
  puts "created #{TARGET_NAME} target"

  ext_group = project.main_group.new_group(TARGET_NAME, TARGET_NAME)
  ext_target.add_file_references(SOURCES.map { |name| ext_group.new_reference(name) })
  ext_group.new_reference('Info.plist')
  ext_group.new_reference("#{TARGET_NAME}.entitlements")
  assets = ext_group.new_reference('Assets.xcassets')
  privacy = ext_group.new_reference('PrivacyInfo.xcprivacy')
  ext_target.add_resources([assets, privacy])
  ext_target.add_system_frameworks(%w[WidgetKit SwiftUI])

  # Version numbers and the signing team follow the App target's same-named
  # configuration, so the release bump (MARKETING_VERSION +
  # CURRENT_PROJECT_VERSION across every target) has one more pair to touch.
  app_settings = app_target.build_configurations.to_h { |c| [c.name, c.build_settings] }
  ext_target.build_configurations.each do |config|
    from_app = app_settings[config.name] || {}
    s = config.build_settings
    s['PRODUCT_BUNDLE_IDENTIFIER'] = BUNDLE_ID
    s['INFOPLIST_FILE'] = "#{TARGET_NAME}/Info.plist"
    s['CODE_SIGN_ENTITLEMENTS'] = "#{TARGET_NAME}/#{TARGET_NAME}.entitlements"
    s['SWIFT_VERSION'] = '5.0'
    s['IPHONEOS_DEPLOYMENT_TARGET'] = DEPLOYMENT_TARGET
    s['TARGETED_DEVICE_FAMILY'] = '1,2'
    s['GENERATE_INFOPLIST_FILE'] = 'NO'
    s['SKIP_INSTALL'] = 'YES'
    s['CODE_SIGN_STYLE'] = 'Automatic'
    s['MARKETING_VERSION'] = from_app['MARKETING_VERSION'] || '1.0'
    s['CURRENT_PROJECT_VERSION'] = from_app['CURRENT_PROJECT_VERSION'] || '1'
    s['DEVELOPMENT_TEAM'] = from_app['DEVELOPMENT_TEAM'] if from_app['DEVELOPMENT_TEAM']
    s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  end

  app_target.add_dependency(ext_target)

  embed = app_target.copy_files_build_phases.find { |p| p.name == 'Embed Foundation Extensions' }
  if embed.nil?
    embed = app_target.new_copy_files_build_phase('Embed Foundation Extensions')
    embed.dst_subfolder_spec = Xcodeproj::Constants::COPY_FILES_BUILD_PHASE_DESTINATIONS[:plug_ins]
    embed.dst_path = ''
  end
  build_file = embed.add_file_reference(ext_target.product_reference)
  build_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
  puts "embedded #{TARGET_NAME} into App"
end

project.save
puts 'project saved'
