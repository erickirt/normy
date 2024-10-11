import {
  createNormalizer,
  type Data,
  type NormalizerConfig,
} from '@normy/core';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

const cleanIds = (ids: string | string[]) => {
  return Array.isArray(ids) ? ids.map(id => `@@${id}`) : `@@${ids}`;
};

const shouldBeNormalized = (
  globalNormalize: boolean,
  localNormalize: boolean | undefined,
) => {
  if (localNormalize === undefined) {
    return globalNormalize;
  }

  return localNormalize;
};

const updateQueriesFromMutationData = (
  mutationData: Data,
  normalizer: ReturnType<typeof createNormalizer>,
  queryClient: QueryClient,
) => {
  const queriesToUpdate = normalizer.getQueriesToUpdate(mutationData);

  queriesToUpdate.forEach(query => {
    queryClient.setQueryData(
      JSON.parse(query.queryKey) as QueryKey,
      () => query.data,
    );
  });
};

export const createQueryNormalizer = (
  queryClient: QueryClient,
  normalizerConfig: Omit<NormalizerConfig, 'structuralSharing'> & {
    normalize?: boolean;
  } = {},
) => {
  const normalize = normalizerConfig.normalize ?? true;
  const normalizer = createNormalizer(normalizerConfig);

  let unsubscribeQueryCache: null | (() => void) = null;
  let unsubscribeMutationCache: null | (() => void) = null;

  return {
    getNormalizedData: normalizer.getNormalizedData,
    setNormalizedData: (data: Data) =>
      updateQueriesFromMutationData(data, normalizer, queryClient),
    clear: normalizer.clearNormalizedData,
    subscribe: () => {
      unsubscribeQueryCache = queryClient.getQueryCache().subscribe(event => {
        if (event.type === 'removed') {
          normalizer.removeQuery(JSON.stringify(event.query.queryKey));
        } else if (
          event.type === 'updated' &&
          event.action.type === 'success' &&
          event.action.data !== undefined &&
          shouldBeNormalized(normalize, event.query.meta?.normalize)
        ) {
          normalizer.setQuery(
            JSON.stringify(event.query.queryKey),
            event.action.data as Data,
          );
        }
      });

      unsubscribeMutationCache = queryClient
        .getMutationCache()
        .subscribe(event => {
          if (
            event.type === 'updated' &&
            event.action.type === 'success' &&
            event.action.data &&
            shouldBeNormalized(normalize, event.mutation.meta?.normalize)
          ) {
            updateQueriesFromMutationData(
              event.action.data as Data,
              normalizer,
              queryClient,
            );
          } else if (
            event.type === 'updated' &&
            event.action.type === 'pending' &&
            (event.mutation.state?.context as { optimisticData?: Data })
              ?.optimisticData
          ) {
            updateQueriesFromMutationData(
              (event.mutation.state.context as { optimisticData: Data })
                .optimisticData,
              normalizer,
              queryClient,
            );
          } else if (
            event.type === 'updated' &&
            event.action.type === 'error' &&
            (event.mutation.state?.context as { rollbackData?: Data })
              ?.rollbackData
          ) {
            updateQueriesFromMutationData(
              (event.mutation.state.context as { rollbackData: Data })
                .rollbackData,
              normalizer,
              queryClient,
            );
          }
        });
    },
    unsubscribe: () => {
      unsubscribeQueryCache?.();
      unsubscribeMutationCache?.();
      unsubscribeQueryCache = null;
      unsubscribeMutationCache = null;
    },
    getObjectById: normalizer.getObjectById,
    getQueryFragment: normalizer.getQueryFragment,
    getQueryKeysById: (ids: string | string[]) => {
      return normalizer
        .getQueriesById(cleanIds(ids))
        .map(key => JSON.parse(key));
    },
    invalidateQueriesById: (ids: string | string[]) => {
      normalizer
        .getQueriesById(cleanIds(ids))
        .map(key => JSON.parse(key))
        .forEach(query => queryClient.invalidateQueries({ queryKey: query }));
    },
  };
};
