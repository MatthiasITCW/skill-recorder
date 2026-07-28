export interface ActiveWindowResult {
  title: string;
  id: number;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  owner?: {
    name?: string;
    processId?: number;
    path?: string;
    bundleId?: string;
  };
}
