import { useInfiniteQuery } from '@tanstack/react-query'
import type { SearchInput, SearchResultPage } from '@/api/client'

export function useSearch(
  input: Omit<SearchInput, 'cursor'> | null,
  search: (input: SearchInput) => Promise<SearchResultPage>,
) {
  return useInfiniteQuery({
    queryKey: ['search', input],
    enabled: input !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => search({ ...input!, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })
}
