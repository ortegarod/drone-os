export type UnitSystem = 'metric' | 'imperial';

export interface UnitPreferences {
  system: UnitSystem;
  distance: string; // 'm' or 'ft'
  speed: string;    // 'm/s' or 'ft/s'
  temperature: string; // 'C' or 'F'
}

// Conversion constants
const METERS_TO_FEET = 3.28084;
const CELSIUS_TO_FAHRENHEIT_MULTIPLIER = 9 / 5;
const CELSIUS_TO_FAHRENHEIT_OFFSET = 32;

// Unit conversion functions
export const convertDistance = (meters: number, system: UnitSystem): number => {
  return system === 'imperial' ? meters * METERS_TO_FEET : meters;
};

export const convertSpeed = (mps: number, system: UnitSystem): number => {
  return system === 'imperial' ? mps * METERS_TO_FEET : mps;
};

export const convertTemperature = (celsius: number, system: UnitSystem): number => {
  return system === 'imperial'
    ? (celsius * CELSIUS_TO_FAHRENHEIT_MULTIPLIER) + CELSIUS_TO_FAHRENHEIT_OFFSET
    : celsius;
};

// Unit label getters
export const getDistanceUnit = (system: UnitSystem): string => {
  return system === 'imperial' ? 'ft' : 'm';
};

export const getSpeedUnit = (system: UnitSystem): string => {
  return system === 'imperial' ? 'ft/s' : 'm/s';
};

export const getTemperatureUnit = (system: UnitSystem): string => {
  return system === 'imperial' ? '°F' : '°C';
};
