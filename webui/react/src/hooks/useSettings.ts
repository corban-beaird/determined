import { Map } from 'immutable';
import * as t from 'io-ts';
import { useObservable } from 'micro-observables';
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { updateUserSetting } from 'services/api';
import { UpdateUserSettingParams } from 'services/types';
import userStore from 'stores/users';
import { Primitive } from 'types';
import { isEqual } from 'utils/data';
import { ErrorType } from 'utils/error';
import handleError from 'utils/error';
import { Loadable } from 'utils/loadable';

import { Settings, SettingsProvider, UserSettings } from './useSettingsProvider';

export interface SettingsConfigProp<A> {
  defaultValue: A;
  skipUrlEncoding?: boolean;
  storageKey: string;
  type: t.Type<A>;
}

export interface SettingsConfig<T> {
  settings: { [K in keyof T]: SettingsConfigProp<T[K]> };
  storagePath: string;
}

interface UserSettingUpdate extends UpdateUserSettingParams {
  userId: number;
}

export type UpdateSettings<T> = (newSettings: Partial<T>) => void;
export type ResetSettings = (settings?: string[]) => void;
type SettingsRecord<T> = { [K in keyof T]: T[K] };

export type UseSettingsReturn<T> = {
  activeSettings: (keys?: string[]) => string[];
  isLoading: boolean;
  resetSettings: ResetSettings;
  settings: T;
  updateSettings: UpdateSettings<T>;
};

const settingsToQuery = <T>(config: SettingsConfig<T>, settings: Settings) => {
  const retVal = new URLSearchParams();
  (Object.values(config.settings) as SettingsConfigProp<T>[]).forEach((setting) => {
    const value = settings[setting.storageKey];
    const isDefault = isEqual(setting.defaultValue, value);
    if (!setting.skipUrlEncoding && !isDefault) {
      if (Array.isArray(value) && value.length > 0) {
        retVal.set(setting.storageKey, value[0]);
        value.slice(1).forEach((subVal) => retVal.append(setting.storageKey, subVal));
      } else if (!Array.isArray(value)) {
        retVal.set(setting.storageKey, value);
      }
    }
  });

  return retVal.toString();
};

const queryParamToType = <T>(
  type:
    | t.Type<SettingsConfig<T>, SettingsConfig<T> | T, unknown>
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    | t.Type<t.ArrayType<any>, t.LiteralType<boolean | number | string>>,
  param: string | null,
): Primitive | undefined => {
  if (param === null || param === undefined) return undefined;
  if (type.is(false)) return param === 'true';
  if (type.is(0)) {
    const value = Number(param);
    return !isNaN(value) ? value : undefined;
  }
  if (type.is({})) return JSON.parse(param);
  if (type.is('')) return param;
  if (type.is([])) {
    if (type instanceof t.UnionType) {
      // UnionType
      return type.types.reduce(
        (
          acc: Primitive | undefined,
          /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
          tComponent: t.Type<t.ArrayType<any>, t.LiteralType<boolean | number | string>>,
        ) => acc ?? (tComponent === t.unknown ? undefined : queryParamToType(tComponent, param)),
        undefined,
      );
    } else if (type instanceof t.ArrayType) {
      // ArrayType
      return queryParamToType(type.type, param);
    }
  }
  // LiteralType
  if (type.is(param)) return param;
  return undefined;
};

const queryToSettings = <T>(config: SettingsConfig<T>, params: URLSearchParams) => {
  return (Object.values(config.settings) as SettingsConfigProp<typeof config>[]).reduce<Settings>(
    (acc, setting) => {
      /*
       * Attempt to decode the query parameter and if anything
       * goes wrong, set it to the default value.
       */
      try {
        const baseType = setting.type;
        const isArray = baseType.is([]);

        let paramValue: null | string | string[] = params.getAll(setting.storageKey);
        if (paramValue.length === 0) {
          paramValue = null;
        } else if (paramValue.length === 1 && !isArray) {
          paramValue = paramValue[0];
        }

        if (paramValue !== null) {
          params.delete(setting.storageKey);

          let queryValue: Primitive | Primitive[] | undefined = undefined;
          /*
           * Convert the string-based query params to primitives.
           * `undefined` values can happen if the query param values are invalid.
           *   string[] => Primitive[] | undefined
           *   string   => Primitive | undefined
           */
          if (Array.isArray(paramValue)) {
            queryValue = paramValue.reduce<Primitive[]>((acc, value) => {
              const parsedValue = queryParamToType<T>(baseType, value);
              if (parsedValue !== undefined) acc.push(parsedValue);
              return acc;
            }, []);
          } else if (!isArray) {
            queryValue = queryParamToType<T>(baseType, paramValue);
          } else {
            queryValue = [paramValue];
          }

          if (queryValue !== undefined) {
            /*
             * When expecting an array, convert valid non-array values into an array.
             * Example - 'PULLING' => [ 'PULLING' ]
             */
            const normalizedValue = (() => {
              if (isArray && !Array.isArray(queryValue)) {
                return [queryValue];
              }
              return queryValue;
            })();

            acc[setting.storageKey] = normalizedValue;
          }
        }
      } catch (e) {
        handleError(e, { silent: true, type: ErrorType.Ui });
      }

      return acc;
    },
    {},
  );
};

const useSettings = <T>(config: SettingsConfig<T>): UseSettingsReturn<T> => {
  const { isLoading, querySettings, state: rawState } = useContext(UserSettings);
  const derivedOb = useMemo(
    () =>
      rawState.select((s) =>
        Loadable.getOrElse(Map<string, Settings>(), s).get(config.storagePath),
      ),
    [rawState, config.storagePath],
  );
  const state = useObservable(derivedOb);
  const navigate = useNavigate();
  const currentUser = Loadable.getOrElse(undefined, useObservable(userStore.currentUser));

  const settings: SettingsRecord<T> = useMemo(
    () =>
      ({
        ...(state ?? {}),
      } as SettingsRecord<T>),
    [state],
  );

  for (const key in config.settings) {
    const setting = config.settings[key];

    if (settings[setting.storageKey as keyof T] === undefined) {
      settings[setting.storageKey as keyof T] = setting.defaultValue;
    }
  }

  /*
   * A setting is considered active if it is set to a value and the
   * value is not equivalent to a default value (if applicable).
   */
  const activeSettings = useCallback(
    (keys?: string[]): string[] => {
      return (Object.values(config.settings) as SettingsConfigProp<T>[]).reduce((acc, prop) => {
        if (!settings) return [];

        const key = prop.storageKey as keyof T;
        const includesKey = !keys || keys.includes(prop.storageKey);
        const isDefault = isEqual(settings[key], prop.defaultValue);

        if (includesKey && !isDefault) acc.push(prop.storageKey);

        return acc;
      }, [] as string[]);
    },
    [config.settings, settings],
  );

  const updateDB = useCallback(
    async (newSettings: Settings, oldSettings: SettingsRecord<T>) => {
      const dbUpdates = Object.keys(newSettings).reduce<UserSettingUpdate[]>((acc, setting) => {
        const newSetting = newSettings[setting];
        const stateSetting = oldSettings?.[setting as keyof T];
        if (currentUser?.id && !isEqual(newSetting, stateSetting)) {
          acc.push({
            setting: {
              key: setting,
              storagePath: config.storagePath,
              value: JSON.stringify(newSettings[setting]),
            },
            storagePath: config.storagePath,
            userId: currentUser.id,
          });
        }

        return acc;
      }, []);

      if (dbUpdates.length !== 0) {
        try {
          // Persist storage to backend.
          await Promise.allSettled(
            dbUpdates.map((update) => {
              updateUserSetting(update);
            }),
          );
        } catch (e) {
          handleError(e, {
            isUserTriggered: false,
            publicMessage: 'Unable to update user settings.',
            publicSubject: 'Some POST user settings failed.',
            silent: true,
            type: ErrorType.Api,
          });
        }
      }
    },
    [config.storagePath, currentUser],
  );

  const resetSettings = useCallback(
    (settingsArray?: string[]) => {
      if (!currentUser) return;

      const array = settingsArray ?? Object.keys(config.settings);

      rawState.update((s) => {
        return Loadable.map(s, (s) => {
          return s.update(config.storagePath, (old) => {
            const news = { ...old };
            array.forEach((setting) => {
              let defaultSetting: SettingsConfigProp<T[Extract<keyof T, string>]> | undefined =
                undefined;

              for (const key in config.settings) {
                const conf = config.settings[key];

                if (conf.storageKey === setting) {
                  defaultSetting = conf;
                  break;
                }
              }

              if (!defaultSetting || !news) return;

              news[setting] = defaultSetting.defaultValue;
            });
            return news;
          });
        });
      });
    },
    [config, currentUser, rawState],
  );

  const updateSettings = useCallback(
    (updates: Partial<Settings>) => {
      rawState.update((s) => {
        return Loadable.map(s, (s) => {
          const oldSettings = s.get(config.storagePath) ?? {};
          const newSettings = { ...s.get(config.storagePath), ...updates };
          return s.set(
            config.storagePath,
            isEqual(oldSettings, newSettings) ? oldSettings : newSettings,
          );
        });
      });
    },
    [config, rawState],
  );

  // parse navigation url to state
  useEffect(() => {
    if (!querySettings) return;

    const parsedSettings = queryToSettings<T>(config, querySettings);
    updateSettings(parsedSettings);
  }, [config, querySettings, updateSettings]);

  useLayoutEffect(() => {
    if (isLoading) return;
    return derivedOb.subscribe(async (cur, prev) => {
      if (!cur || !currentUser || isEqual(cur, prev)) return;

      await updateDB(cur, prev as unknown as SettingsRecord<T>);

      if (
        (Object.values(config.settings) as SettingsConfigProp<typeof config>[]).every(
          (setting) => !!setting.skipUrlEncoding,
        )
      ) {
        return;
      }
      const mappedSettings = settingsToQuery(config, cur);
      const url = mappedSettings ? `?${mappedSettings}` : '';
      navigate(url, { replace: true });
    });
  }, [currentUser, derivedOb, navigate, config, updateDB, isLoading]);

  return {
    activeSettings,
    isLoading: isLoading,
    resetSettings,
    settings,
    updateSettings,
  };
};

export { SettingsProvider, useSettings };
