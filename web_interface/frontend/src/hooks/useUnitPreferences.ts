import { useState } from 'react';
import { UnitSystem } from '../utils/unitConversions';

/**
 * Custom hook to manage unit system preferences with localStorage persistence
 */
export const useUnitPreferences = () => {
  const [unitSystem, setUnitSystem] = useState<UnitSystem>(() => {
    const saved = localStorage.getItem('droneOS_units');
    return (saved as UnitSystem) || 'metric';
  });

  const changeUnitSystem = (system: UnitSystem) => {
    setUnitSystem(system);
    localStorage.setItem('droneOS_units', system);
  };

  return {
    unitSystem,
    changeUnitSystem
  };
};
