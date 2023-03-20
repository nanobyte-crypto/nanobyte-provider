import { io, Socket } from "socket.io-client";
import axios from "axios";

interface NanobyteProvider {
  connect: (apiKey: string) => Promise<{
    status: string;
    account?: string;
    nonce?: string;
    signature?: string;
    sessionKey?: string;
  }>;
  verifyAuth: (
    apiKey: string,
    nonce: string
  ) => Promise<{
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
  disconnect: (
    apiKey: string,
    sessionKey: string
  ) => Promise<{
    status: string;
  }>;
  requestPayment: (
    apiKey: string,
    sessionKey: string,
    paymentDetails: {
      price: string;
      currency: string;
      label: string;
      message: string;
      metadata: {
        [key: string]: any; // Allow for custom metadata fields
      };
    }
  ) => Promise<{
    paymentId: string;
    paymentStatus: string;
    paymentHash?: string;
  }>;
  verifyPayment: (
    apiKey: string,
    paymentId: string
  ) => Promise<{
    paymentId: string;
    paymentStatus: string;
    metadata: {
      [key: string]: any; // Allow for custom metadata fields
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
  getUserAccountBalance: (sessionKey: string) => Promise<{
    balance: string;
  }>;
  getPayoutAddressDetails: (apiKey: string) => Promise<{
    address: string;
    balance: string;
  }>;
  payoutUser: (
    apiKey: string,
    secretKey: string,
    sessionKey: string,
    amount: string
  ) => Promise<{
    payoutStatus: string;
    payoutHash: string;
  }>;
}

let NANOBYTE_API_URL = process.env.NANOBYTE_PROVIDER_URL || "https://api.nanobytepay.com";
let nanobyteSocket: Socket;
let sessionKey: string;
let isConnecting: boolean = false; // Prevent multiple connections

const getWebSocketConnection = async () => {
  return new Promise((resolve, reject) => {
    if (!!nanobyteSocket && nanobyteSocket.connected) {
      resolve(nanobyteSocket);
    } else {
      nanobyteSocket = io(NANOBYTE_API_URL + "/wallet-bridge", {
        transports: ["websocket"],
      });
      nanobyteSocket.on("connect", () => {
        resolve(nanobyteSocket);
      });
    }
  });
};

//Manage login data in local storage
const storeLoginData = (apiKey: string, data: any) => {
  const loginData = JSON.stringify(data);
  localStorage.setItem(apiKey, loginData);
};

const removeLoginData = (apiKey: string) => {
  localStorage.removeItem(apiKey);
};

const retrieveLoginData = (apiKey: string) => {
  const loginData = localStorage.getItem(apiKey);
  if (loginData) {
    return JSON.parse(loginData);
  }
};

const nanobyte: NanobyteProvider = {
  // Here we connect to the nanobyte socket and authenticate the user and establish a session
  connect: (apiKey) => {
    return new Promise(async (resolve, reject) => {
      if (!apiKey) {
        reject({
          error: "no_api_key",
          details: "You need to provide an API key",
        });
        return;
      }

      // Check to see if we are already connecting
      if (!!isConnecting) {
        reject({
          error: "connection_in_progress",
          details: "Connection is already in progress",
        });
        return;
      }

      // Reset the flag when the connection is completed or cancelled
      const resetConnectionFlag = () => {
        isConnecting = false;
      };

      isConnecting = true;

      // connect to nanobyte socket:
      const socket: any = await getWebSocketConnection();

      //Begin authentication
      socket.emit("initConnection", { apiKey }, (data: any) => {
        //We get a nonce back from the server that the user needs to sign
        const { merchantName, nonce } = data;
        sessionKey = data.sessionKey;

        let request: any = {
          nonce: nonce,
          merchantName: merchantName,
          sessionKey: data.sessionKey,
          methods: [
            {
              type: "http",
              subtype: "auth",
              url: NANOBYTE_API_URL + "/auth",
            },
            {
              type: "http",
              subtype: "cancel",
              url: NANOBYTE_API_URL + "/api/nano/process/cancelauth",
            },
          ],
        };
        //We use deeplinked to find the users preferred app to sign the message
        const authStr = `nanoauth:${btoa(JSON.stringify(request))}`;
        const link = document.createElement("a");
        link.href = authStr;
        document.body.appendChild(link);
        link.click();
        link.remove();
      });

      //We listen for the response from the server after it has verified the signature
      socket.on("connectionCompleted", async (data: any) => {
        if (data.status === "rejected") {
          // send the rejected status back to the merchant if the signature is invalid
          resetConnectionFlag();
          reject({
            error: "auth_rejected",
            details: "Authentication rejected - signed with wrong key",
          });
          return;
        }
        // send the authenticated status back to the merchant if the signature is valid

        //Store the login data in local storage
        storeLoginData(apiKey, data);
        resetConnectionFlag();
        //Here we want to make sure the wallet has joined the room before we resolve the promise

        resolve(data);
        return;
      });
      //We listen for the response from the server if the user cancels the authentication
      socket.on("connectionCancelled", async (data: any) => {
        // send the cancelled status back to the merchant
        resetConnectionFlag();
        reject({
          error: "auth_cancelled",
          details: "User cancelled authentication",
        });
        return;
      });
    });
  },
  verifyAuth(apiKey, nonce) {
    return new Promise((resolve, reject) => {
      const config = {
        headers: {
          "x-api-key": apiKey,
        },
      };

      axios
        .get(`${NANOBYTE_API_URL}/api/nano/auth/${nonce}`, config)
        .then((response) => response.data)
        .then((data) => {
          if (!!data.status) {
            switch (data.status) {
              case "authenticated":
                resolve(data);
                break;
              case "rejected":
                reject({
                  error: "auth_rejected",
                  details: "Authentication rejected - signed with wrong key",
                });
                break;
              case "cancelled":
                reject({
                  error: "auth_cancelled",
                  details: "User cancelled authentication",
                });
                break;
            }
          }
          return;
        })
        .catch((error) => {
          reject(error.response.data);
        });
    });
  },
  isConnected: (apiKey) => {
    //Create the socket connection if it doesn't exist
    return new Promise(async (resolve, reject) => {
      //If we dont have a websocket connection, create one

      if (!apiKey) {
        reject({
          error: "no_api_key",
          details: "You need to provide an api key",
        });
        return;
      }

      const loginData = retrieveLoginData(apiKey);

      if (!loginData) {
        resolve({
          connected: false,
        });
        return;
      }

      const socket: any = await getWebSocketConnection();
      socket.emit("checkConnection", { sessionKey: loginData.sessionKey }, (data: any) => {
        if (!!data.connected) {
          let response = {
            connected: data.connected,
            connectionData: loginData,
          };
          resolve(response);
        } else {
          removeLoginData(apiKey);
          resolve({
            connected: false,
          });
        }
        return;
      });

      //If we have a websocket connection, check if it's the wallet is connected to the session
    });
  },
  // Disconnect the user from the session
  async disconnect(apiKey, sessionKey) {
    return new Promise(async (resolve, reject) => {
      if (!sessionKey) {
        reject({
          error: "no_session_key",
          details: "Your not connected to a wallet",
        });
        return;
      }
      if (!apiKey) {
        reject({
          error: "no_api_key",
          details: "You need to provide an API key",
        });
        return;
      }

      const socket: any = await getWebSocketConnection();
      socket.emit("disconnectWallet", { sessionKey });
      removeLoginData(apiKey);
      socket.close();
      resolve({ status: "disconnected" });
      return;
    });
  },
  // Request a payment from the user
  requestPayment: (apiKey, sessionKey, paymentDetails) => {
    return new Promise(async (resolve, reject) => {
      //Has the merchant provided an API key?
      if (!sessionKey) {
        reject({
          error: "no_session_key",
          details: "Your not connected to a wallet",
        });
        return;
      }
      if (!apiKey) {
        reject({
          error: "no_api_key",
          details: "You need to provide an API key",
        });
        return;
      }

      //Check to see if the payment details are valid
      if (!paymentDetails.price || !paymentDetails.label || !paymentDetails.currency) {
        reject({
          error: "invalid_payment_details",
          details: "You need to provide a price, label and currency",
        });
        return;
      }

      const socket: any = await getWebSocketConnection();

      const { price, label, message, metadata } = paymentDetails;
      const currency = paymentDetails.currency.toUpperCase();
      let amount: string;

      let amountRequestData = {
        price,
        currency,
      };

      //We need to get the payment amount in RAW from the server
      socket.emit("requestAmount", amountRequestData, async (data: any) => {
        if (data.error) {
          reject(data);
          return;
        }
        //We get the amount back and build the request for the wallet
        amount = data.amount;

        let request: any = {
          amount,
          label,
          message,
          methods: [
            {
              type: "http",
              subtype: "handoff",
              url: NANOBYTE_API_URL + "/handoff",
            },
            {
              type: "http",
              subtype: "cancel",
              url: NANOBYTE_API_URL + "/api/nano/process/cancelpayment",
            },
          ],
          metadata: {
            ...paymentDetails?.metadata,
            merchantApiKey: apiKey,
            price: price,
            currency: currency,
            sessionKey: sessionKey,
          },
        };

        //Send the request to the wallet
        socket.emit("initPayment", request, (data: any) => {
          if (!!data.error) {
            reject(data);
            return;
          }
        });
      });

      //subscribe to payment results:
      socket.on("paymentResults", (data: any) => {
        // send the payment status back to the merchant
        //build the response
        let response: any = {
          paymentId: data.paymentId,
          paymentStatus: data.paymentStatus,
        };

        if (!!data?.metadata?.paymentHash) {
          response.paymentHash = data.metadata.paymentHash;
        }
        resolve(response);
        return;
      });
    });
  },
  verifyPayment(apiKey, paymentId) {
    return new Promise((resolve, reject) => {
      if (!apiKey) {
        reject({
          error: "no_api_key",
          details: "You need to provide an API key",
        });
        return;
      }

      if (!paymentId) {
        reject({
          error: "no_payment_id",
          details: "You need to provide a payment id",
        });
        return;
      }

      const config = {
        headers: {
          "x-api-key": apiKey,
        },
      };
      //Poll the payment status as a fallback for the websocket
      axios
        .get(`${NANOBYTE_API_URL}/api/nano/payments/${paymentId}`, config)
        .then((response) => response.data)
        .then((data) => {
          if (!!data.paymentStatus) {
            //build the response
            resolve(data);
            return;
          }
        })
        .catch((error) => {
          reject(error.response.data);
        });
    });
  },

  getUserAccountBalance: (sessionKey) => {
    return new Promise(async (resolve, reject) => {
      //Get the account balance from the wallet
      if (!sessionKey) {
        reject({
          error: "no_session_key",
          details: "You need to provide a session key",
        });
        return;
      }

      const socket: any = await getWebSocketConnection();

      socket.emit("requestAccountBalance", { sessionKey });
      socket.on("accountBalanceResponse", (data: any) => {
        resolve(data);
        return;
      });
    });
  },
  getPayoutAddressDetails(apiKey) {
    //Create the socket connection if it doesn't exist
    return new Promise(async (resolve, reject) => {
      if (!apiKey) {
        reject({
          error: "no_api_key",
          details: "You need to provide an API key",
        });
        return;
      }

      const socket: any = await getWebSocketConnection();

      socket.emit("requestPayoutAddressDetails", { apiKey }, (data: any) => {
        if (data.error) {
          reject(data);
          return;
        }
        resolve(data);
        return;
      });
    });
  },
  payoutUser(apiKey, secretKey, sessionKey, amount) {
    return new Promise(async (resolve, reject) => {
      if (!apiKey) {
        reject({
          error: "no_api_key",
          details: "You need to provide an API key",
        });
        return;
      }
      if (!sessionKey) {
        reject({
          error: "no_session_key",
          details: "You need to provide a session key",
        });
        return;
      }
      if (!secretKey) {
        reject({
          error: "no_secret_key",
          details: "You need to provide a secret key",
        });
        return;
      }
      if (!amount) {
        reject({
          error: "no_amount",
          details: "You need to provide an amount in Nano",
        });
        return;
      }

      const socket: any = await getWebSocketConnection();

      socket.emit("payoutUser", { apiKey, secretKey, sessionKey, amount }, (data: any) => {
        resolve(data);
        return;
      });
    });
  },
};

export default nanobyte;
