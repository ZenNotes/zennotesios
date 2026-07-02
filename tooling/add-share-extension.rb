# Wires the ShareExtension target into the Capacitor-generated Xcode project,
# and adds the app-local plugin sources + entitlements to the App target.
# Idempotent: safe to re-run (skips work that's already done).
#
# Run with the xcodeproj gem vendored in Homebrew's CocoaPods:
#   GEM_PATH=$(ls -d /opt/homebrew/Cellar/cocoapods/*/libexec | head -1) \
#     ruby tooling/add-share-extension.rb
require 'xcodeproj'

project_path = File.expand_path('../ios/App/App.xcodeproj', __dir__)
project = Xcodeproj::Project.open(project_path)

app_target = project.targets.find { |t| t.name == 'App' }
raise 'App target not found' unless app_target

# --- App target: local plugin sources + entitlements -----------------------

app_group = project.main_group['App']
%w[ShareInboxPlugin.swift ZNViewController.swift].each do |name|
  next if app_group.files.any? { |f| f.display_name == name }
  ref = app_group.new_reference(name)
  app_target.add_file_references([ref])
  puts "added #{name} to App target"
end

app_target.build_configurations.each do |config|
  config.build_settings['CODE_SIGN_ENTITLEMENTS'] ||= 'App/App.entitlements'
end

# --- ShareExtension target --------------------------------------------------

ext_target = project.targets.find { |t| t.name == 'ShareExtension' }
if ext_target.nil?
  ext_target = project.new_target(:app_extension, 'ShareExtension', :ios, '14.0')
  puts 'created ShareExtension target'

  ext_group = project.main_group.new_group('ShareExtension', 'ShareExtension')
  src_ref = ext_group.new_reference('ShareViewController.swift')
  ext_group.new_reference('Info.plist')
  ext_group.new_reference('ShareExtension.entitlements')
  ext_target.add_file_references([src_ref])

  ext_target.build_configurations.each do |config|
    s = config.build_settings
    s['PRODUCT_BUNDLE_IDENTIFIER'] = 'md.zennotes.ShareExtension'
    s['INFOPLIST_FILE'] = 'ShareExtension/Info.plist'
    s['CODE_SIGN_ENTITLEMENTS'] = 'ShareExtension/ShareExtension.entitlements'
    s['SWIFT_VERSION'] = '5.0'
    s['IPHONEOS_DEPLOYMENT_TARGET'] = '14.0'
    s['TARGETED_DEVICE_FAMILY'] = '1,2'
    s['GENERATE_INFOPLIST_FILE'] = 'NO'
    s['SKIP_INSTALL'] = 'YES'
    s['CODE_SIGN_STYLE'] = 'Automatic'
    s['MARKETING_VERSION'] = '1.0'
    s['CURRENT_PROJECT_VERSION'] = '1'
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
  puts 'embedded ShareExtension into App'
end

project.save
puts 'project saved'
