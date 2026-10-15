declare module "commonmark-spec" {
  export interface SpecExample {
    markdown: string;
    html: string;
    section: string;
    number: number;
  }
  const spec: { text: string; tests: SpecExample[] };
  export default spec;
}
