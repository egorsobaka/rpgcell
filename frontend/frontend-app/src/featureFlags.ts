/**
 * Реестр feature flags для управления функциональностью приложения
 */
export const FeatureFlags = {
  // Показ параметров клетки как всплывающих подсказок с иконками
  SHOW_CELL_INFO_POPUPS: false,
  
  // Здесь можно добавить другие feature flags
  // EXAMPLE_FEATURE: true,
} as const;

export type FeatureFlag = keyof typeof FeatureFlags;

/**
 * Проверяет, включен ли feature flag
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return FeatureFlags[flag] === true;
}
