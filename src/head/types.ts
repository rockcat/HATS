/** Face region bounds as fractions [0,1] of the texture image dimensions */
export interface FaceBounds {
  top: number;    // forehead top  (fraction of image height, 0 = image top)
  bottom: number; // chin bottom
  left: number;   // left cheek/ear edge (fraction of image width, 0 = image left)
  right: number;  // right cheek/ear edge
}

export interface HeadConfig {
  modelPath: string;       // path to .glb file
  texturePath: string;     // path to DALL-E generated face PNG
  faceBounds?: FaceBounds; // detected face region in the texture
  width?: number;          // render width, default 512
  height?: number;         // render height, default 512
}

export type MorphWeights = Partial<Record<string, number>>;

export interface HeadModel {
  config: HeadConfig;
  morphTargetNames: string[];
}
