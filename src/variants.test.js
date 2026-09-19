import { describe, expect, it } from 'vitest';
import { cpVariants, cpChip, cpStripSize, dcVariant } from './variants.js';

const ab = (file, extra = {}) => ({ file, x: 0, y: 0, w: 1440, h: 900, ...extra });

describe('cpVariants', () => {
  it('folds a file whose CamelCase name starts with another file name', () => {
    const { primaryOf } = cpVariants([ab('SignIn.dc.html'), ab('SignInWrong.dc.html'), ab('SignInArabic.dc.html'), ab('SignInPhone.dc.html')]);
    expect(['SignInWrong.dc.html', 'SignInArabic.dc.html', 'SignInPhone.dc.html'].map(primaryOf)).toEqual(Array(3).fill('SignIn.dc.html'));
  });
  it('takes the longest match and walks to the root', () => {
    const { primaryOf } = cpVariants([ab('UserCreate.dc.html'), ab('UserCreateMinimized.dc.html'), ab('UserCreateMinimizedPhone.dc.html'), ab('UserCreated.dc.html'), ab('UserCreated2K.dc.html')]);
    expect(primaryOf('UserCreateMinimizedPhone.dc.html')).toBe('UserCreate.dc.html');
    expect(primaryOf('UserCreated2K.dc.html')).toBe('UserCreated.dc.html');
  });
  it('keeps a slot when variantOf is null', () => {
    const { primaryOf } = cpVariants([ab('SignIn.dc.html'), ab('SignInWrong.dc.html', { variantOf: null })]);
    expect(primaryOf('SignInWrong.dc.html')).toBe('SignInWrong.dc.html');
  });
  it('reads the language and state axes from the name and the overrides', () => {
    const list = [ab('SignIn.dc.html'), ab('SignInWrong.dc.html'), ab('SignInArabic.dc.html'), ab('SignInPhone.dc.html'), ab('SignInOdd.dc.html', { lang: 'ar', state: 'Locked' })];
    const { axesOf } = cpVariants(list);
    const root = list[0];
    expect(axesOf(list[1], root)).toEqual({ lang: 'en', state: 'Wrong' });
    expect(axesOf(list[2], root)).toEqual({ lang: 'ar', state: '' });
    expect(axesOf(list[3], root)).toEqual({ lang: 'en', state: '' });
    expect(axesOf(list[4], root)).toEqual({ lang: 'ar', state: 'Locked' });
  });
});

describe('chip helpers', () => {
  it('names the wide sizes and strips the size from a title', () => {
    expect([cpChip(2560), cpChip(3840), cpChip(390)]).toEqual(['2K', '4K', '390']);
    expect(cpStripSize('Sign in · 1440×900')).toBe('Sign in');
    expect(cpStripSize('1440×900')).toBe('1440×900');
  });
});

describe('dcVariant', () => {
  const variants = [
    { file: 'A.dc.html', w: 1440, h: 900, href: './A.dc.html', chip: '1440', primary: true, lang: 'en', state: '' },
    { file: 'AWrong.dc.html', w: 1440, h: 900, href: './AWrong.dc.html', chip: '1440', lang: 'en', state: 'Wrong' },
    { file: 'APhone.dc.html', w: 390, h: 844, href: './APhone.dc.html', chip: '390', lang: 'en', state: '' },
  ];
  it('gives the primary and one chip group per axis that varies', () => {
    const v = dcVariant({ variants }, undefined);
    expect([v.width, v.height, v.href]).toEqual([1440, 900, './A.dc.html']);
    expect(v.axes.map((a) => a.key)).toEqual(['size', 'state']);
    expect(v.axes[0].chips.map((c) => c.label)).toEqual(['1440', '390']);
    expect(v.axes[1].chips.map((c) => c.label)).toEqual(['Main', 'Wrong']);
  });
  it('follows the chosen file and falls back to the size props', () => {
    expect(dcVariant({ variants }, 'APhone.dc.html').width).toBe(390);
    expect(dcVariant({ width: 800, height: 600, href: './B.dc.html' }, undefined)).toMatchObject({ width: 800, height: 600, href: './B.dc.html', axes: [] });
  });
});
