import { Order, OrderItem, Settings } from "@/lib/db";

interface ReceiptProps {
  order: Order;
  orderItems: OrderItem[];
  settings: Settings;
}

export default function Receipt({ order, orderItems, settings }: ReceiptProps) {
  return (
    <div className="bg-white text-black p-6 max-w-sm mx-auto font-mono text-sm">
      {/* Header */}
      <div className="text-center border-b border-black pb-4 mb-4">
        <h1 className="text-xl font-bold">{settings.storeName}</h1>
        <p className="text-xs">{settings.storeEmail}</p>
        <p className="text-xs">{settings.storePhone}</p>
      </div>

      {/* Order Info */}
      <div className="mb-4 text-xs">
        <p>Order: {order.id}</p>
        <p>Date: {new Date(order.createdAt).toLocaleString()}</p>
        <p>Payment: {order.paymentMethod}</p>
      </div>

      {/* Items */}
      <div className="border-t border-b border-black py-2 mb-2">
        {orderItems.map((item) => (
          <div key={item.id} className="mb-2">
            <div className="flex justify-between">
              <span className="font-semibold">{item.nameSnapshot}</span>
              <span>${item.lineTotal.toFixed(2)}</span>
            </div>
            {(item.size || item.color) && (
              <div className="text-xs text-gray-600 ml-2">
                {item.size && `Size: ${item.size}`} {item.color && `Color: ${item.color}`}
              </div>
            )}
            <div className="text-xs text-gray-600 ml-2">
              {item.quantity} × ${item.unitPrice.toFixed(2)}
              {item.lineDiscount > 0 && ` (−$${item.lineDiscount.toFixed(2)})`}
            </div>
            {item.notes && (
              <div className="text-xs text-gray-600 ml-2 italic">Note: {item.notes}</div>
            )}
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="space-y-1 text-xs mb-4">
        <div className="flex justify-between">
          <span>Subtotal:</span>
          <span>${order.subtotal.toFixed(2)}</span>
        </div>
        {order.discountTotal > 0 && (
          <div className="flex justify-between">
            <span>Discount:</span>
            <span>−${order.discountTotal.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Tax:</span>
          <span>${order.taxTotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between font-bold text-base border-t border-black pt-1 mt-1">
          <span>TOTAL:</span>
          <span>${order.total.toFixed(2)}</span>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-xs border-t border-black pt-4">
        <p>Thank you for your purchase!</p>
        <p className="mt-1">Visit us again soon</p>
      </div>
    </div>
  );
}
