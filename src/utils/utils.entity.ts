export interface SearchResult {
  position: number;
  title: string;
  prerender: boolean;
  cache_page_url: object;
  related_pages_url: object;
  url: string;
  domain: string;
  displayed_url: string;
}