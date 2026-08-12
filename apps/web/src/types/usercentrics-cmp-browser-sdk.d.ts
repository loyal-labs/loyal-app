declare module "@usercentrics/cmp-browser-sdk" {
  export enum UI_LAYER {
    FIRST_LAYER = "FIRST_LAYER",
    NONE = "NONE",
    PRIVACY_BUTTON = "PRIVACY_BUTTON",
    SECOND_LAYER = "SECOND_LAYER",
  }

  export enum UI_VARIANT {
    CCPA = "CCPA",
    DEFAULT = "DEFAULT",
    TCF = "TCF",
  }

  export type UserDecision = {
    serviceId: string;
    status: boolean;
  };

  export type BaseService = {
    categorySlug: string;
    consent: {
      status: boolean;
    };
    description: string;
    id: string;
    isEssential: boolean;
    isHidden: boolean;
    name: string;
  };

  export type InitialUIValues = {
    initialLayer: UI_LAYER;
    variant: UI_VARIANT;
  };

  export type InitOptions = {
    createTcfApiStub?: boolean;
  };

  export default class Usercentrics {
    constructor(settingsId: string, options?: InitOptions);
    init(): Promise<InitialUIValues>;
    acceptAllServices(): Promise<void>;
    denyAllServices(): Promise<void>;
    getServicesBaseInfo(): BaseService[];
    updateServices(decisions: UserDecision[]): Promise<void>;
    updateLayer(layer: UI_LAYER): Promise<void>;
  }
}
