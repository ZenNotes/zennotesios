# Adds the PrivacyInfo.xcprivacy manifests to the App and ShareExtension
# targets' Resources phases (Apple requires a privacy manifest for
# required-reason APIs — UserDefaults, file timestamps). Idempotent.
#
# Run with the xcodeproj gem vendored in Homebrew's CocoaPods:
#   GEM_PATH=$(ls -d /opt/homebrew/Cellar/cocoapods/*/libexec | head -1) \
#     ruby tooling/add-privacy-manifests.rb
require 'xcodeproj'

project_path = File.expand_path('../ios/App/App.xcodeproj', __dir__)
project = Xcodeproj::Project.open(project_path)

{
  'App' => 'App',
  'ShareExtension' => 'ShareExtension'
}.each do |target_name, group_name|
  target = project.targets.find { |t| t.name == target_name }
  raise "#{target_name} target not found" unless target

  group = project.main_group[group_name]
  raise "#{group_name} group not found" unless group

  file_ref = group.files.find { |f| f.display_name == 'PrivacyInfo.xcprivacy' }
  file_ref ||= group.new_reference('PrivacyInfo.xcprivacy')

  already = target.resources_build_phase.files_references.include?(file_ref)
  target.add_resources([file_ref]) unless already
  puts "#{target_name}: PrivacyInfo.xcprivacy #{already ? 'already present' : 'added'}"
end

project.save
puts 'saved'
