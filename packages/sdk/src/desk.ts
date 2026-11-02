import type {
  CreateDeskCaseRequest,
  DeskCaseDetailResponse,
  DeskCaseResponse,
  ListDeskCasesResponse,
  DeskProductInput,
  DeskReportResponse,
  DeskReportStatus,
  ListDeskReportsResponse,
  DeskProductResponse,
  DeskReadinessResponse,
  DeskSettingsInput,
  DeskSettingsResponse,
  EscalationChainResponse,
  EscalationStepInput,
  ListDeskProductsResponse,
} from "@saas/contracts/desk";

import type { RequestOptions, Transport } from "./transport.js";

/** The reporting desk. Maps to `apps/desk-worker` through the api-edge desk facade. */
export class DeskClient {
  constructor(private readonly transport: Transport) {}

  private path(orgId: string, rest: string): string {
    return `/v1/organizations/${encodeURIComponent(orgId)}/desk/${rest}`;
  }

  readiness(orgId: string, opts: RequestOptions = {}): Promise<DeskReadinessResponse> {
    return this.transport.request({ method: "GET", path: this.path(orgId, "readiness") }, opts);
  }

  listProducts(orgId: string, opts: RequestOptions = {}): Promise<ListDeskProductsResponse> {
    return this.transport.request({ method: "GET", path: this.path(orgId, "products") }, opts);
  }

  createProduct(orgId: string, body: DeskProductInput, opts: RequestOptions = {}): Promise<DeskProductResponse> {
    return this.transport.request({ method: "POST", path: this.path(orgId, "products"), body }, opts);
  }

  updateProduct(orgId: string, id: string, body: DeskProductInput, opts: RequestOptions = {}): Promise<DeskProductResponse> {
    return this.transport.request(
      { method: "PATCH", path: this.path(orgId, `products/${encodeURIComponent(id)}`), body },
      opts,
    );
  }

  deleteProduct(orgId: string, id: string, opts: RequestOptions = {}): Promise<{ deleted: boolean }> {
    return this.transport.request(
      { method: "DELETE", path: this.path(orgId, `products/${encodeURIComponent(id)}`) },
      opts,
    );
  }

  getSettings(orgId: string, opts: RequestOptions = {}): Promise<DeskSettingsResponse> {
    return this.transport.request({ method: "GET", path: this.path(orgId, "settings") }, opts);
  }

  saveSettings(orgId: string, body: DeskSettingsInput, opts: RequestOptions = {}): Promise<DeskSettingsResponse> {
    return this.transport.request({ method: "PUT", path: this.path(orgId, "settings"), body }, opts);
  }

  getEscalation(orgId: string, opts: RequestOptions = {}): Promise<EscalationChainResponse> {
    return this.transport.request({ method: "GET", path: this.path(orgId, "escalation") }, opts);
  }

  saveEscalation(orgId: string, steps: EscalationStepInput[], opts: RequestOptions = {}): Promise<EscalationChainResponse> {
    return this.transport.request({ method: "PUT", path: this.path(orgId, "escalation"), body: { steps } }, opts);
  }

  listReports(orgId: string, opts: RequestOptions = {}): Promise<ListDeskReportsResponse> {
    return this.transport.request({ method: "GET", path: this.path(orgId, "reports") }, opts);
  }

  getReport(orgId: string, id: string, opts: RequestOptions = {}): Promise<DeskReportResponse> {
    return this.transport.request({ method: "GET", path: this.path(orgId, `reports/${encodeURIComponent(id)}`) }, opts);
  }

  setReportStatus(orgId: string, id: string, status: DeskReportStatus, opts: RequestOptions = {}): Promise<DeskReportResponse> {
    return this.transport.request(
      { method: "PATCH", path: this.path(orgId, `reports/${encodeURIComponent(id)}`), body: { status } },
      opts,
    );
  }

  listCases(orgId: string, opts: RequestOptions = {}): Promise<ListDeskCasesResponse> {
    return this.transport.request({ method: "GET", path: this.path(orgId, "cases") }, opts);
  }

  createCase(orgId: string, body: CreateDeskCaseRequest, opts: RequestOptions = {}): Promise<DeskCaseResponse> {
    return this.transport.request({ method: "POST", path: this.path(orgId, "cases"), body }, opts);
  }

  getCase(orgId: string, id: string, opts: RequestOptions = {}): Promise<DeskCaseDetailResponse> {
    return this.transport.request({ method: "GET", path: this.casePath(orgId, id) }, opts);
  }

  acknowledgeCase(orgId: string, id: string, opts: RequestOptions = {}): Promise<DeskCaseResponse> {
    return this.transport.request({ method: "POST", path: `${this.casePath(orgId, id)}/acknowledge`, body: {} }, opts);
  }

  addCaseNote(orgId: string, id: string, note: string, opts: RequestOptions = {}): Promise<DeskCaseResponse> {
    return this.transport.request({ method: "POST", path: `${this.casePath(orgId, id)}/notes`, body: { note } }, opts);
  }

  correctAwareness(orgId: string, id: string, awareAt: string, reason: string, opts: RequestOptions = {}): Promise<DeskCaseResponse> {
    return this.transport.request({ method: "PUT", path: `${this.casePath(orgId, id)}/awareness`, body: { awareAt, reason } }, opts);
  }

  recordCorrectiveMeasure(orgId: string, id: string, availableAt: string, description: string, opts: RequestOptions = {}): Promise<DeskCaseResponse> {
    return this.transport.request(
      { method: "PUT", path: `${this.casePath(orgId, id)}/corrective-measure`, body: { availableAt, description } },
      opts,
    );
  }

  closeCase(orgId: string, id: string, reason: string, opts: RequestOptions = {}): Promise<DeskCaseResponse> {
    return this.transport.request({ method: "POST", path: `${this.casePath(orgId, id)}/close`, body: { reason } }, opts);
  }

  private casePath(orgId: string, id: string): string {
    return this.path(orgId, `cases/${encodeURIComponent(id)}`);
  }
}
