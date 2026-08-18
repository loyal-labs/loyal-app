Pod::Spec.new do |s|
  s.name           = 'ExpoSyncedKeychain'
  s.version        = '0.1.0'
  s.summary        = 'iCloud Keychain (kSecAttrSynchronizable) item storage'
  s.description    = 'Reads and writes generic-password keychain items marked synchronizable, so iCloud Keychain carries them across the user devices. iOS only.'
  s.author         = ''
  s.homepage       = 'https://askloyal.com'
  s.platforms      = {
    :ios => '15.1',
    :tvos => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
