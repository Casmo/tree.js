export { CURRENT_SCHEMA_VERSION, MAX_BRANCH_LEVELS } from './types';
export type {
  TreeDefinition,
  TreeDefinitionInput,
  DeepPartial,
  HexColor,
  Vec3Tuple,
  TreeForm,
  TrunkDefinition,
  BranchLevelDefinition,
  LeafShape,
  LeavesDefinition,
  Shading,
  MaterialsDefinition,
  BarkMaterialDefinition,
  LeafMaterialDefinition,
  Keyframe,
  SeasonProfileDefinition,
  WindResponseDefinition,
  VariationDefinition,
  Sculpt,
  DeleteSculpt,
  MoveSculpt,
  LeavesSculpt,
} from './types';
export { DEFAULT_DEFINITION, DEFAULT_BRANCH_LEVEL } from './defaults';
export {
  parseDefinition,
  extendDefinition,
  fetchDefinition,
  TreeDefinitionError,
  type DefinitionPatch,
} from './parse';
