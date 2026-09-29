export const decideCheckout = (input: {
  intentStatus: string
  cashfreeOrderStatus: string | null
}): "already_paid" | "open_checkout" => {
  if (input.intentStatus === "paid") return "already_paid"
  if (input.cashfreeOrderStatus === "PAID") return "already_paid"
  return "open_checkout"
}
