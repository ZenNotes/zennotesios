require 'xcodeproj'

project = Xcodeproj::Project.open(File.expand_path('../ios/App/App.xcodeproj', __dir__))
target = project.targets.find { |candidate| candidate.name == 'App' }
group = project.main_group['App']
raise 'App target or group not found' unless target && group

%w[CloudFilesPlugin.swift CloudFileStream.swift].each do |name|
  reference = group.files.find { |file| file.display_name == name } || group.new_reference(name)
  target.add_file_references([reference]) unless target.source_build_phase.files_references.include?(reference)
end

project.save
