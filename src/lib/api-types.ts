// Auth Types
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  data: {
    token: string;
    user: {
      id: string;
      email: string;
      name: string;
      roleIds: string[];
      roles: Array<{
        id: string;
        name: string;
        systemRole?: string;
        permissions: any;
      }>;
    };
  };
}

export interface SessionResponse {
  success: boolean;
  data: {
    user: {
      id: string;
      email: string;
      name: string;
      roleIds: string[];
      status: string;
      roles: any[];
    };
  };
}

// Product Types
export interface Product {
  id: string;
  name: string;
  description?: string;
  category: string;
  basePrice: number;
  image?: string;
  barcode?: string;
  variants: ProductVariant[];
  createdAt: number;
  updatedAt: number;
}

export interface ProductVariant {
  id: string;
  size?: string;
  color?: string;
  priceOverride?: number;
  priceDelta?: number;
  sku?: string;
  barcode?: string;
  stock: number;
  enabled: boolean;
}

export interface CreateProductRequest {
  name: string;
  description?: string;
  category?: string;
  basePrice: number;
  image?: string;
  barcode?: string;
  variants?: Omit<ProductVariant, 'id'>[];
}

export interface UpdateProductRequest {
  name?: string;
  description?: string;
  category?: string;
  basePrice?: number;
  image?: string;
  barcode?: string;
}

// Order Types
export interface Order {
  id: string;
  createdAt: number;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  paymentMethod: string;
  customerEmail?: string;
  customerPhone?: string;
  items?: OrderItem[];
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  variantId: string;
  nameSnapshot: string;
  size?: string;
  color?: string;
  quantity: number;
  unitPrice: number;
  lineDiscount: number;
  lineTotal: number;
  notes?: string;
}

export interface CreateOrderRequest {
  items: Array<{
    productId: string;
    variantId?: string;
    nameSnapshot: string;
    size?: string;
    color?: string;
    quantity: number;
    unitPrice: number;
    lineDiscount?: number;
    lineTotal: number;
    notes?: string;
  }>;
  subtotal: number;
  discountTotal?: number;
  taxTotal?: number;
  total: number;
  paymentMethod: string;
  customerEmail?: string;
  customerPhone?: string;
}

// Customer Types
export interface Customer {
  id: string;
  name: string;
  org?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateCustomerRequest {
  name: string;
  org?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  notes?: string;
}

// API Response Wrapper
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

