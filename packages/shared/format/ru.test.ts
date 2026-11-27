import { describe, expect, it } from 'vitest'

import {
  accusative,
  formatDecimalRu,
  instrumental,
  MONTHS_GENITIVE,
  MONTHS_SHORT,
  nameGender,
  pluralRu,
} from './ru'

describe('pluralRu', () => {
  const days = (count: number) => pluralRu(count, 'день', 'дня', 'дней')

  it('takes the "one" form for 1, 21 and 101', () => {
    for (const count of [1, 21, 101]) expect(days(count)).toBe('день')
  })

  it('takes the "few" form for 2, 4 and 22', () => {
    for (const count of [2, 4, 22]) expect(days(count)).toBe('дня')
  })

  it('takes the "many" form for 0, 5, the teens and 111, 112', () => {
    for (const count of [0, 5, 11, 14, 111, 112]) expect(days(count)).toBe('дней')
  })
})

describe('formatDecimalRu', () => {
  it('pads to the given digits and writes a decimal comma', () => {
    expect(formatDecimalRu(4.3, 2)).toBe('4,30')
    expect(formatDecimalRu(4.32, 2)).toBe('4,32')
    expect(formatDecimalRu(0.5, 1)).toBe('0,5')
  })
})

describe('month names', () => {
  it('spells the genitive months from января to декабря', () => {
    expect(MONTHS_GENITIVE).toHaveLength(12)
    expect(MONTHS_GENITIVE[0]).toBe('января')
    expect(MONTHS_GENITIVE[11]).toBe('декабря')
  })

  it('abbreviates the months for chart axes', () => {
    expect(MONTHS_SHORT).toEqual([
      'янв',
      'фев',
      'мар',
      'апр',
      'мая',
      'июн',
      'июл',
      'авг',
      'сен',
      'окт',
      'ноя',
      'дек',
    ])
    expect(MONTHS_SHORT[10]).toBe('ноя')
  })
})

describe('nameGender', () => {
  it('follows the given sex', () => {
    expect(nameGender('Барсик', 'female')).toBe('female')
    expect(nameGender('Буся', 'male')).toBe('male')
  })

  it('reads a consonant or "-й" as masculine and "-а", "-я", "-ь" as feminine without one', () => {
    expect(nameGender('Барсик', null)).toBe('male')
    expect(nameGender('Тимофей', null)).toBe('male')
    expect(nameGender('Буся', null)).toBe('female')
    expect(nameGender('Мурка', null)).toBe('female')
    expect(nameGender('Рысь', null)).toBe('female')
  })
})

describe('accusative', () => {
  it('turns "-а" into "-у" and "-я" into "-ю" for either sex', () => {
    expect(accusative('Буся', 'female')).toBe('Бусю')
    expect(accusative('Офелия', null)).toBe('Офелию')
    expect(accusative('Мурка', 'female')).toBe('Мурку')
    expect(accusative('Миша', 'male')).toBe('Мишу')
  })

  it('declines a male consonant, "-й" and "-ь" name like an animate noun', () => {
    expect(accusative('Барсик', 'male')).toBe('Барсика')
    expect(accusative('Барсик', null)).toBe('Барсика')
    expect(accusative('Тимофей', 'male')).toBe('Тимофея')
    expect(accusative('Игорь', 'male')).toBe('Игоря')
  })

  it('drops the fleeting vowel of "-ец", "-ок" and "-ёк"', () => {
    expect(accusative('Огурец', 'male')).toBe('Огурца')
    expect(accusative('Пушок', 'male')).toBe('Пушка')
    expect(accusative('Уголёк', 'male')).toBe('Уголька')
  })

  it('leaves a feminine "-ь" or consonant name, a vowel ending and a foreign name alone', () => {
    expect(accusative('Рысь', 'female')).toBe('Рысь')
    expect(accusative('Рысь', null)).toBe('Рысь')
    expect(accusative('Кэт', 'female')).toBe('Кэт')
    expect(accusative('Мими', 'female')).toBe('Мими')
    expect(accusative('Luna', 'female')).toBe('Luna')
  })
})

describe('instrumental', () => {
  it('declines the common cat names, and leaves the rest alone', () => {
    expect(instrumental('Офелия', null)).toBe('Офелией')
    expect(instrumental('Буся', null)).toBe('Бусей')
    expect(instrumental('Мурка', null)).toBe('Муркой')
    expect(instrumental('Маша', null)).toBe('Машей')
    expect(instrumental('Барсик', null)).toBe('Барсиком')
    expect(instrumental('Мишка', null)).toBe('Мишкой')
    expect(instrumental('Кузя', null)).toBe('Кузей')
    expect(instrumental('Мими', null)).toBe('Мими')
    expect(instrumental('Luna', null)).toBe('Luna')
  })

  it('gives a feminine "-ь" name "-ью" and a masculine one "-ем"', () => {
    expect(instrumental('Рысь', 'female')).toBe('Рысью')
    expect(instrumental('Рысь', null)).toBe('Рысью')
    expect(instrumental('Игорь', 'male')).toBe('Игорем')
    expect(instrumental('Тимофей', 'male')).toBe('Тимофеем')
  })

  it('drops the fleeting vowel of "-ец", "-ок" and "-ёк"', () => {
    expect(instrumental('Огурец', 'male')).toBe('Огурцом')
    expect(instrumental('Пушок', null)).toBe('Пушком')
    expect(instrumental('Уголёк', 'male')).toBe('Угольком')
  })

  it('leaves a feminine consonant name alone', () => {
    expect(instrumental('Кэт', 'female')).toBe('Кэт')
  })
})
