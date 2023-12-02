// export interface SearchResult {
//   position: number;
//   title: string;
//   prerender: boolean;
//   cache_page_url: object;
//   related_pages_url: object;
//   url: string;
//   domain: string;
//   displayed_url: string;
// }

export interface SearchResult {
  position: number;
  title: string;
  snippet: boolean;
  highlights: any[];
  displayed_link: string;
  url: string;
}
