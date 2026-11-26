# 端末の中でルートを計算するモジュール（設計書 2.1）。valhalla-mobile（Swift Package）を包む
Pod::Spec.new do |s|
  s.name           = 'CubRouting'
  s.version        = '0.1.0'
  s.summary        = 'Valhalla を端末の中で動かす'
  s.license        = 'MIT'
  s.author         = 'cub-navigation-2'
  s.homepage       = 'https://github.com/tamai-hideyuki/cub-navigation-2'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # valhalla-mobile は Swift Package でだけ配られているので、React Native の spm_dependency で足す
  spm_dependency(s,
    url: 'https://github.com/Rallista/valhalla-mobile.git',
    requirement: { kind: 'exactVersion', version: '0.6.6' },
    products: ['Valhalla']
  )

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,swift}'
end
