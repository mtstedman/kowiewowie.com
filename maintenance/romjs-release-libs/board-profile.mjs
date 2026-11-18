const PROFILE_FIELDS = Object.freeze([
  'board',
  'battery',
  'prgRamBytes',
  'prgNvramBytes',
  'chrRamBytes',
  'startup',
]);

function freezeProfile(profile) {
  return Object.freeze({ ...profile });
}

const SUPPORTED_PROFILES = Object.freeze([
  Object.freeze({ mapper: 9, profile: freezeProfile({
    board: 'PNROM',
    battery: false,
    prgRamBytes: 0,
    prgNvramBytes: 0,
    chrRamBytes: 0,
    startup: 'mmc2-pnrom-operational-v1',
  }) }),
  Object.freeze({ mapper: 1, profile: freezeProfile({
    board: 'SNROM',
    battery: false,
    prgRamBytes: 8192,
    prgNvramBytes: 0,
    chrRamBytes: 8192,
    startup: 'mmc1-snrom-control-12-zero-banks',
  }) }),
  Object.freeze({ mapper: 4, profile: freezeProfile({
    board: 'standard-txrom',
    battery: false,
    prgRamBytes: 0,
    prgNvramBytes: 0,
    chrRamBytes: 0,
    startup: 'explicit-banks-zero-irq',
  }) }),
  Object.freeze({ mapper: 4, profile: freezeProfile({
    board: 'standard-txrom',
    battery: false,
    prgRamBytes: 8192,
    prgNvramBytes: 0,
    chrRamBytes: 0,
    startup: 'explicit-banks-zero-irq',
  }) }),
]);

export class BoardProfileError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'BoardProfileError';
    this.code = code;
  }
}

function profileError(code, message) {
  throw new BoardProfileError(code, message);
}

function exactProfile(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === PROFILE_FIELDS.length
    && PROFILE_FIELDS.every((field) => Object.hasOwn(value, field));
}

function sameProfile(left, right) {
  return PROFILE_FIELDS.every((field) => Object.is(left[field], right[field]));
}

function publicProfile(profile) {
  return freezeProfile(Object.fromEntries(PROFILE_FIELDS.map((field) => [field, profile[field]])));
}

export function validateBoardProfile(hardware, policy) {
  if (!exactProfile(policy) || typeof policy.startup !== 'string') {
    profileError('UNSUPPORTED_PROFILE', 'profile policy shape');
  }

  const knownStartup = SUPPORTED_PROFILES.some((candidate) => candidate.profile.startup === policy.startup);
  if (!knownStartup) {
    profileError('UNSUPPORTED_PROFILE', `startup policy ${String(policy.startup)}`);
  }

  const supported = SUPPORTED_PROFILES.find((candidate) => sameProfile(candidate.profile, policy));
  if (!supported) {
    profileError('UNSUPPORTED_PROFILE', 'board/RAM/startup policy');
  }

  if (hardware === null || typeof hardware !== 'object' || Array.isArray(hardware)) {
    profileError('PROFILE_MISMATCH', 'hardware description');
  }

  const startup = hardware.startup ?? hardware.startupPolicyId;
  if (typeof startup !== 'string' || !SUPPORTED_PROFILES.some((candidate) => candidate.profile.startup === startup)) {
    profileError('UNSUPPORTED_PROFILE', `startup policy ${String(startup)}`);
  }

  const actual = {
    board: hardware.board,
    battery: hardware.battery,
    prgRamBytes: hardware.prgRamBytes,
    prgNvramBytes: hardware.prgNvramBytes,
    chrRamBytes: hardware.chrRamBytes,
    startup,
  };

  for (const field of PROFILE_FIELDS) {
    if (!Object.is(actual[field], supported.profile[field])) {
      profileError('PROFILE_MISMATCH', `${field} expected ${JSON.stringify(supported.profile[field])}, got ${JSON.stringify(actual[field])}`);
    }
  }
  if (!Object.is(hardware.mapper, supported.mapper)) {
    profileError('PROFILE_MISMATCH', `mapper expected ${supported.mapper}, got ${JSON.stringify(hardware.mapper)}`);
  }

  return publicProfile(supported.profile);
}
