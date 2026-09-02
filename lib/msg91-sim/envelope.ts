export const BULK_ACCEPTED_MESSAGE =
  "Your request is in process, check delivery reports for status"

export function bulkSuccess(requestId: string, uuid: string) {
  return {
    status: "success" as const,
    hasError: false as const,
    data: BULK_ACCEPTED_MESSAGE,
    request_id: requestId,
    uuid,
  }
}

export function bulkFail(message: string) {
  return {
    status: "fail" as const,
    hasError: true as const,
    errors: { message },
  }
}

export function bulkOk(data: unknown, extra?: Record<string, unknown>) {
  return {
    status: "success" as const,
    hasError: false as const,
    data,
    ...extra,
  }
}

export function sessionSuccess(uuid: string) {
  return {
    type: "success" as const,
    message: "Message sent successfully",
    uuid,
  }
}

export function sessionError(message: string) {
  return {
    type: "error" as const,
    message,
  }
}

export const TEMPLATE_STATUSES = ["pending", "approved", "rejected"] as const

export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number]

export function isTemplateStatus(value: string): value is TemplateStatus {
  return TEMPLATE_STATUSES.includes(value as TemplateStatus)
}

export function canSendTemplate(status: string): boolean {
  return status.toLowerCase() === "approved"
}

export function matchesTemplateStatusFilter(rowStatus: string, filter?: string): boolean {
  if (!filter) {
    return true
  }
  return rowStatus.toLowerCase() === filter.toLowerCase()
}
