// The model registry (MLflow or Databricks Unity Catalog) is for the model being built, so it opens at stage 4,
// Design and development. Before that there is no model to register. Shared by the screens, the store and the server.
export const REGISTRY_FROM_STAGE = 4;
export const registryOpen = (sys) => Number(sys?.stage ?? sys?.data?.stage ?? 1) >= REGISTRY_FROM_STAGE;
export const REGISTRY_CLOSED_TEXT = 'The model registry opens at stage 4, Design and development, when the model is being built.';
