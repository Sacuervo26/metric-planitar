export type CountryMeta = {
  code: string;
  name: string;
  heroBackgroundImage: string;
};

const COUNTRY_META: Record<string, CountryMeta> = {
  CO: {
    code: 'CO',
    name: 'Colombia',
    heroBackgroundImage:
      'linear-gradient(180deg, rgba(250, 208, 44, 0.98) 0%, rgba(250, 208, 44, 0.98) 54%, rgba(0, 56, 168, 0.96) 54%, rgba(0, 56, 168, 0.96) 77%, rgba(206, 17, 38, 0.96) 77%, rgba(206, 17, 38, 0.96) 100%)',
  },
  PH: {
    code: 'PH',
    name: 'Philippines',
    heroBackgroundImage:
      'linear-gradient(180deg, rgba(0, 56, 168, 0.96) 0%, rgba(0, 56, 168, 0.96) 50%, rgba(206, 17, 38, 0.96) 50%, rgba(206, 17, 38, 0.96) 100%), linear-gradient(122deg, rgba(255, 255, 255, 0.98) 0%, rgba(255, 255, 255, 0.98) 21%, rgba(255, 255, 255, 0) 21.4%), radial-gradient(circle at 10% 48%, rgba(250, 204, 21, 0.95) 0%, rgba(250, 204, 21, 0.7) 6%, rgba(250, 204, 21, 0) 18%)',
  },
  AU: {
    code: 'AU',
    name: 'Australia',
    heroBackgroundImage:
      'linear-gradient(135deg, rgba(1, 33, 105, 0.97) 0%, rgba(1, 33, 105, 0.97) 64%, rgba(207, 20, 43, 0.88) 100%), radial-gradient(circle at 78% 24%, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0.9) 5%, rgba(255, 255, 255, 0) 18%)',
  },
  US: {
    code: 'US',
    name: 'United States',
    heroBackgroundImage:
      'linear-gradient(180deg, rgba(191, 10, 48, 0.96) 0%, rgba(191, 10, 48, 0.96) 12.5%, rgba(255, 255, 255, 0.96) 12.5%, rgba(255, 255, 255, 0.96) 25%, rgba(191, 10, 48, 0.96) 25%, rgba(191, 10, 48, 0.96) 37.5%, rgba(255, 255, 255, 0.96) 37.5%, rgba(255, 255, 255, 0.96) 50%, rgba(191, 10, 48, 0.96) 50%, rgba(191, 10, 48, 0.96) 62.5%, rgba(255, 255, 255, 0.96) 62.5%, rgba(255, 255, 255, 0.96) 75%, rgba(191, 10, 48, 0.96) 75%, rgba(191, 10, 48, 0.96) 87.5%, rgba(255, 255, 255, 0.96) 87.5%, rgba(255, 255, 255, 0.96) 100%), linear-gradient(90deg, rgba(10, 49, 97, 0.97) 0%, rgba(10, 49, 97, 0.97) 28%, rgba(10, 49, 97, 0) 28%)',
  },
  MX: {
    code: 'MX',
    name: 'Mexico',
    heroBackgroundImage:
      'linear-gradient(90deg, rgba(0, 104, 71, 0.97) 0%, rgba(0, 104, 71, 0.97) 33.33%, rgba(255, 255, 255, 0.97) 33.33%, rgba(255, 255, 255, 0.97) 66.66%, rgba(206, 17, 38, 0.97) 66.66%, rgba(206, 17, 38, 0.97) 100%)',
  },
  CA: {
    code: 'CA',
    name: 'Canada',
    heroBackgroundImage:
      'linear-gradient(90deg, rgba(215, 38, 61, 0.97) 0%, rgba(215, 38, 61, 0.97) 26%, rgba(255, 255, 255, 0.97) 26%, rgba(255, 255, 255, 0.97) 74%, rgba(215, 38, 61, 0.97) 74%, rgba(215, 38, 61, 0.97) 100%)',
  },
  BR: {
    code: 'BR',
    name: 'Brazil',
    heroBackgroundImage:
      'linear-gradient(135deg, rgba(0, 156, 59, 0.97) 0%, rgba(0, 156, 59, 0.97) 100%), radial-gradient(circle at 50% 50%, rgba(255, 223, 0, 0.93) 0%, rgba(255, 223, 0, 0.93) 17%, rgba(255, 223, 0, 0) 18%)',
  },
  PE: {
    code: 'PE',
    name: 'Peru',
    heroBackgroundImage:
      'linear-gradient(90deg, rgba(217, 16, 35, 0.97) 0%, rgba(217, 16, 35, 0.97) 33.33%, rgba(255, 255, 255, 0.97) 33.33%, rgba(255, 255, 255, 0.97) 66.66%, rgba(217, 16, 35, 0.97) 66.66%, rgba(217, 16, 35, 0.97) 100%)',
  },
  AR: {
    code: 'AR',
    name: 'Argentina',
    heroBackgroundImage:
      'linear-gradient(180deg, rgba(108, 180, 238, 0.97) 0%, rgba(108, 180, 238, 0.97) 33.33%, rgba(255, 255, 255, 0.97) 33.33%, rgba(255, 255, 255, 0.97) 66.66%, rgba(108, 180, 238, 0.97) 66.66%, rgba(108, 180, 238, 0.97) 100%)',
  },
  CL: {
    code: 'CL',
    name: 'Chile',
    heroBackgroundImage:
      'linear-gradient(180deg, rgba(255, 255, 255, 0.97) 0%, rgba(255, 255, 255, 0.97) 50%, rgba(213, 43, 30, 0.97) 50%, rgba(213, 43, 30, 0.97) 100%), linear-gradient(90deg, rgba(0, 57, 166, 0.97) 0%, rgba(0, 57, 166, 0.97) 24%, rgba(0, 57, 166, 0) 24%)',
  },
  IN: {
    code: 'IN',
    name: 'India',
    heroBackgroundImage:
      'linear-gradient(180deg, rgba(255, 153, 51, 0.97) 0%, rgba(255, 153, 51, 0.97) 33.33%, rgba(255, 255, 255, 0.97) 33.33%, rgba(255, 255, 255, 0.97) 66.66%, rgba(19, 136, 8, 0.97) 66.66%, rgba(19, 136, 8, 0.97) 100%), radial-gradient(circle at 50% 50%, rgba(0, 0, 128, 0.7) 0%, rgba(0, 0, 128, 0.7) 4%, rgba(0, 0, 128, 0) 10%)',
  },
};

function fallbackCountryName(code: string) {
  return code === 'GLOBAL' ? 'Global' : code;
}

export function normalizeTeam(value: string) {
  return String(value ?? '').trim().toUpperCase();
}

export function isRrePodTeam(team: string) {
  return /^RRE[A-Z]{2,4}\d+$/i.test(normalizeTeam(team));
}

export function getCountryCodeFromTeam(team: string) {
  const match = normalizeTeam(team).match(/^RRE([A-Z]{2,4})\d+$/i);
  return match?.[1]?.toUpperCase() ?? 'GLOBAL';
}

export function getCountryMetaFromTeam(team: string): CountryMeta {
  const code = getCountryCodeFromTeam(team);
  return (
    COUNTRY_META[code] ?? {
      code,
      name: fallbackCountryName(code),
      heroBackgroundImage:
        'linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.92) 45%, rgba(59, 130, 246, 0.88) 100%)',
    }
  );
}
