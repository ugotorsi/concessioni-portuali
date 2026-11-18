export interface OfficialLegalReference {
  kind: string;
  authorityHint: string | null;
  actType: string | null;
  actNumber: string | null;
  year: number | null;
  chamberSection: string | null;
}

export interface OfficialLegalReferenceLegislationHit {
  documentKind: "LEGISLATION";
  providerRecordId: string;
  providerSourceId: string;
  sourceType: string;
  actNumber: string;
  actYear: number;
  issuedAt: Date | null;
  description: string | null;
  title: string | null;
  publicationNumber: string | null;
  publishedAt: Date | null;
}

export interface OfficialLegalReferenceCaseLawHit {
  documentKind: "CASE_LAW";
  providerRecordId: string;
  providerSourceId: string;
  authority: string;
  court: string | null;
  decisionNumber: string;
  decisionYear: number;
  decidedAt: Date | null;
  chamberSection: string | null;
  decisionType: string | null;
  ecli?: string | null;
  publicationDate?: Date | null;
  subject?: string | null;
  outcome?: string | null;
  title: string | null;
  sourceUrl: string | null;
}

export type OfficialLegalReferenceHit =
  | OfficialLegalReferenceLegislationHit
  | OfficialLegalReferenceCaseLawHit;

export type OfficialLegalReferenceLookupResult =
  | { status: "NOT_FOUND"; resultCount: 0; hits: [] }
  | { status: "FOUND_UNIQUE"; resultCount: 1; hits: [OfficialLegalReferenceHit] }
  | { status: "AMBIGUOUS"; resultCount: number; hits: OfficialLegalReferenceHit[] };

export interface OfficialLegalReferenceProvider {
  readonly providerKey: string;
  readonly lookupVersion: string;
  supports(reference: OfficialLegalReference): boolean;
  lookup(reference: OfficialLegalReference): Promise<OfficialLegalReferenceLookupResult>;
}

export interface OfficialLegalReferenceProviderIdentity {
  providerKey: string;
  lookupVersion: string;
}

export class OfficialLegalReferenceProviderError extends Error {
  constructor(
    readonly providerKey: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "OfficialLegalReferenceProviderError";
  }
}

export class OfficialLegalReferenceProviderRegistry {
  private readonly providers = new Map<string, OfficialLegalReferenceProvider>();

  constructor(providers: readonly OfficialLegalReferenceProvider[]) {
    for (const provider of providers) {
      if (this.providers.has(provider.providerKey)) {
        throw new Error("DUPLICATE_OFFICIAL_LEGAL_REFERENCE_PROVIDER");
      }
      this.providers.set(provider.providerKey, provider);
    }
  }

  resolve(identity: OfficialLegalReferenceProviderIdentity): OfficialLegalReferenceProvider | null {
    const provider = this.providers.get(identity.providerKey);
    return provider?.lookupVersion === identity.lookupVersion ? provider : null;
  }

  route(reference: OfficialLegalReference): OfficialLegalReferenceProviderIdentity[] {
    return [...this.providers.values()]
      .filter((provider) => provider.supports(reference))
      .map(({ providerKey, lookupVersion }) => ({ providerKey, lookupVersion }));
  }
}