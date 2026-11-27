import { describe, expect, it } from 'vitest'

import { chooseScanCamera } from './choose-camera'

const cam = (deviceId: string, label: string) => ({ deviceId, label })

describe('chooseScanCamera on iOS', () => {
  const english = [
    cam('front', 'Front Camera'),
    cam('wide', 'Back Camera'),
    cam('ultra', 'Back Ultra Wide Camera'),
    cam('tele', 'Back Telephoto Camera'),
    cam('dual', 'Back Dual Camera'),
    cam('dualwide', 'Back Dual Wide Camera'),
    cam('triple', 'Back Triple Camera'),
  ]

  it('prefers the Dual Wide virtual camera, then Triple, then Dual', () => {
    expect(chooseScanCamera(english)).toBe('dualwide')
    const noDualWide = english.filter((d) => d.deviceId !== 'dualwide')
    expect(chooseScanCamera(noDualWide)).toBe('triple')
    expect(chooseScanCamera(noDualWide.filter((d) => d.deviceId !== 'triple'))).toBe('dual')
  })

  it('takes the plain wide lens when there is no virtual camera, never ultra-wide or telephoto', () => {
    expect(
      chooseScanCamera([
        cam('ultra', 'Back Ultra Wide Camera'),
        cam('tele', 'Back Telephoto Camera'),
        cam('wide', 'Back Camera'),
      ]),
    ).toBe('wide')
  })

  it.each([
    ['Russian', 'Задняя двойная широкоугольная камера', 'Задняя тройная камера', 'Задняя камера'],
    ['Ukrainian', 'Задня здвоєна ширококутна камера', 'Задня потрійна камера', 'Задня камера'],
    ['Polish', 'Tylny dwuobiektywowy aparat szerokokątny', 'Tylny aparat potrójny', 'Tylny aparat'],
    ['German', 'Rückseitige Dual-Weitwinkelkamera', 'Rückseitige Dreifachkamera', 'Rückkamera'],
    ['French', 'Double caméra grand angle arrière', 'Triple caméra arrière', 'Caméra arrière'],
  ])('reads the translated labels of a %s iPhone', (_language, dualWide, triple, wide) => {
    const devices = [cam('wide', wide), cam('triple', triple), cam('dualwide', dualWide)]

    expect(chooseScanCamera(devices)).toBe('dualwide')
    expect(chooseScanCamera(devices.filter((d) => d.deviceId !== 'dualwide'))).toBe('triple')
  })

  it('skips a translated ultra-wide or telephoto lens', () => {
    expect(
      chooseScanCamera([
        cam('ultra', 'Задняя сверхширокоугольная камера'),
        cam('tele', 'Задняя телефотокамера'),
        cam('wide', 'Задняя камера'),
      ]),
    ).toBe('wide')
  })
})

describe('chooseScanCamera on Android', () => {
  it('takes the lowest-id back camera whatever the list order (OnePlus 15)', () => {
    expect(
      chooseScanCamera([
        cam('f', 'camera 1, facing front'),
        cam('b4', 'camera 4, facing back'),
        cam('b3', 'camera 3, facing back'),
        cam('b2', 'camera 2, facing back'),
        cam('b0', 'camera 0, facing back'),
      ]),
    ).toBe('b0')
  })

  it('reads the older camera2 labels too', () => {
    expect(
      chooseScanCamera([
        cam('f', 'camera2 1, facing front'),
        cam('b2', 'camera2 2, facing back'),
        cam('b0', 'camera2 0, facing back'),
      ]),
    ).toBe('b0')
  })
})

describe('chooseScanCamera fallback', () => {
  it('leaves the choice to the browser when labels are unreadable or no back camera is named', () => {
    expect(chooseScanCamera([cam('a', ''), cam('b', '')])).toBeNull()
    expect(chooseScanCamera([cam('w', 'Integrated Webcam')])).toBeNull()
  })
})
