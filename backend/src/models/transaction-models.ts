interface Transaction {
  // Fraud Detection Data
  phone: string;
  deviceId: string;
  ipAddress: string;
  
  // Payment Data
  transactionId: string;
  amount: number;
  paymentMethod: 'QRIS' | 'VA' | 'LINK';
  status: 'PENDING' | 'PAID' | 'EXPIRED';
  
  // Invoice Details
  customer: {
    name: string;
    email: string;
    phone: string;
  };
  items: Array<{
    name: string;
    price: number;
  }>;
  invoicePdfUrl?: string;
  createdAt: Date;
}