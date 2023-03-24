interface NanobyteProvider {
    connect: (apiKey: string) => Promise<{
        status: string;
        account?: string;
        nonce?: string;
        signature?: string;
        sessionKey?: string;
    }>;
    onDisconnect: (apiKey: string, callback: (data: any) => void) => void;
    onBalanceUpdate: (apiKey: string, callback: (data: any) => void) => void;
    verifyAuth: (apiKey: string, nonce: string) => Promise<{
        status: string;
        account?: string;
        nonce?: string;
        signature?: string;
        sessionKey?: string;
    }>;
    isConnected: (apiKey: string) => Promise<{
        connected: boolean;
        connectionData?: {
            status?: string;
            account?: string;
            nonce?: string;
            signature?: string;
            sessionKey?: string;
        };
    }>;
    disconnect: (apiKey: string, sessionKey: string) => Promise<{
        status: string;
    }>;
    requestPayment: (apiKey: string, sessionKey: string, paymentDetails: {
        price: string;
        currency: string;
        label: string;
        message: string;
        metadata?: {
            [key: string]: any;
        };
    }) => Promise<{
        paymentId: string;
        paymentStatus: string;
        paymentHash?: string;
    }>;
    verifyPayment: (apiKey: string, paymentId: string) => Promise<{
        paymentId: string;
        paymentStatus: string;
        metadata: {
            [key: string]: any;
            price: string;
            currency: string;
            sessionKey: string;
            label: string;
            merchantName: string;
            paymentHash: string;
            amount: string;
            customerAddress: string;
            settlementHash: string;
        };
    }>;
    getPayoutAddressDetails: (apiKey: string) => Promise<{
        address: string;
        balance: string;
    }>;
    payoutUser: (apiKey: string, secretKey: string, sessionKey: string, amount: string) => Promise<{
        payoutStatus: string;
        payoutHash: string;
    }>;
}
declare const nanobyte: NanobyteProvider;
export default nanobyte;
//# sourceMappingURL=index.d.mts.map