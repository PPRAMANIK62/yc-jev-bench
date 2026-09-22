import { SearchApp } from "@/components/search/search-app";

function first(v: string | string[] | undefined): string | null {
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

export default async function Home({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  return <SearchApp initial={{ q: first(params.q), intent: first(params.intent) }} />;
}
