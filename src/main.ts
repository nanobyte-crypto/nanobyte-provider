import { io } from "socket.io-client";

interface NanobyteProvider {
  connect: (apiKey: string) => Promise<{
    status: string;
    account?: string;
    nonce?: string;
    signature?: string;
    sessionKey?: string;
  }>;
  isConnected: (sessionKey: string) => Promise<boolean>;
  disconnect: (sessionKey: string) => void;
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
  getUserAccountBalance: (sessionKey: string) => Promise<string>;
  getMerchantAccountBalance: (apiKey: string) => Promise<{
    address: string;
    balance: string;
  }>;
  payUser: (
    apiKey: string,
    payoutDetails: {
      amount: string;
      userAddress: string;
    }
  ) => Promise<{
    paymentStatus: string;
    paymentHash: string;
  }>;
  test: () => void;
}

let TEST_URL = process.env.PROVIDER_URL || import.meta.env.VITE_APP_PROVIDER_URL;

let NANOBYTE_API_URL = process.env.PROVIDER_URL || "https://api.nanobytepay.com";
let nanobyteSocket: any;
let sessionKey: string;

const nanobyte: NanobyteProvider = {
  test: () => {
    nanobyteSocket = io(NANOBYTE_API_URL + "/wallet-bridge", {
      transports: ["polling", "websocket"],
    });

    nanobyteSocket.on("connect_error", (err: any) => {
      // revert to classic upgrade
      console.log(`connect_error due to ${err.message}`);
      //nanobyteSocket.io.opts.transports = ["polling", "websocket"];
    });
  },
  // Here we connect to the nanobyte socket and authenticate the user and establish a session
  connect: (apiKey) => {
    return new Promise((resolve, reject) => {
      if (!apiKey) {
        reject({
          error: "no_api_key",
          details: "You need to provide an API key",
        });
        return;
      }

      // connect to nanobyte socket:
      nanobyteSocket = io(NANOBYTE_API_URL + "/wallet-bridge", {
        transports: ["websocket"],
      });

      // When we connect we need to authenticate the user
      nanobyteSocket.on("connect", () => {
        console.log(nanobyteSocket);

        //Begin authentication
        nanobyteSocket.emit("initConnection", { apiKey }, (data: any) => {
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

          const config = {
            headers: {
              "x-api-key": apiKey,
            },
          };

          //Poll the auth result as a fallback for the websocket
          fetch(`${NANOBYTE_API_URL}/api/nano/auth/${nonce}`, {
            method: "GET",
            headers: config.headers,
          })
            .then((response) => response.json())
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
              console.error(error);
            });
        });

        //We listen for the response from the server after it has verified the signature
        nanobyteSocket.on("connectionCompleted", async (data: any) => {
          if (data.status === "rejected") {
            // send the rejected status back to the merchant if the signature is invalid
            reject({
              error: "auth_rejected",
              details: "Authentication rejected - signed with wrong key",
            });
            return;
          }
          // send the authenticated status back to the merchant if the signature is valid
          resolve(data);
          return;
        });
        //We listen for the response from the server if the user cancels the authentication
        nanobyteSocket.on("connectionCancelled", async (data: any) => {
          // send the cancelled status back to the merchant
          reject({
            error: "auth_cancelled",
            details: "User cancelled authentication",
          });
          return;
        });
      });
    });
  },
  // Disconnect the user from the session
  disconnect(sessionKey) {
    nanobyteSocket.emit("disconnectWallet", { sessionKey });
    nanobyteSocket.close();
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

      const { price, label, message, metadata } = paymentDetails;
      const currency = paymentDetails.currency.toUpperCase();
      let amount: string;

      let amountRequestData = {
        price,
        currency,
      };

      //We need to get the payment amount in RAW from the server
      nanobyteSocket.emit("getAmount", amountRequestData, async (data: any) => {
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
        nanobyteSocket.emit("initPayment", request, (data: any) => {
          if (!!data.error) {
            reject(data);
            return;
          }

          const { paymentId } = data;

          const config = {
            headers: {
              "x-api-key": apiKey,
            },
          };

          //Poll the payment status as a fallback for the websocket
          fetch(`${NANOBYTE_API_URL}/api/nano/payments/${paymentId}`, {
            method: "GET",
            headers: config.headers,
          })
            .then((response) => response.json())
            .then((data) => {
              if (!!data.paymentStatus) {
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
              }
            })
            .catch((error) => {
              console.error(error);
            });
        });
      });

      //subscribe to payment results:
      nanobyteSocket.on("paymentResults", (data: any) => {
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

      nanobyteSocket.emit("requestAccountBalance", { sessionKey });
      nanobyteSocket.on("accountBalance", (data: any) => {
        resolve(data);
        return;
      });
    });
  },
  isConnected: (sessionKey) => {
    //Create the socket connection if it doesn't exist
    return new Promise(async (resolve, reject) => {
      //If we dont have a websocket connection, create one

      if (!sessionKey) {
        reject({
          error: "no_session_key",
          details: "You need to provide a session key",
        });
        return;
      }

      if (!nanobyteSocket) {
        nanobyteSocket = io(NANOBYTE_API_URL + "/wallet-bridge", {
          transports: ["websocket"],
        });

        nanobyteSocket.on("connect", () => {
          nanobyteSocket.emit("checkConnection", { sessionKey }, (data: any) => {
            resolve(data.connected);
            return;
          });
        });
        //If we have a websocket connection, check if it's the wallet is connected to the session
      } else {
        nanobyteSocket.emit("checkConnection", { sessionKey }, (data: any) => {
          resolve(data.connected);
          return;
        });
      }
    });
  },
  getMerchantAccountBalance(apiKey) {
    //Create the socket connection if it doesn't exist
    return new Promise(async (resolve, reject) => {
      if (!nanobyteSocket) {
        nanobyteSocket = io(NANOBYTE_API_URL + "/wallet-bridge", {
          transports: ["websocket"],
        });

        nanobyteSocket.on("connect", () => {
          nanobyteSocket.emit("requestMerchantAccountBalance", { apiKey }, (data: any) => {
            resolve(data);
            return;
          });
        });
      } else {
        nanobyteSocket.emit("requestMerchantAccountBalance", { apiKey }, (data: any) => {
          resolve(data);
          return;
        });
      }
    });
  },
  payUser(apiKey, payoutDetails) {
    return new Promise(async (resolve, reject) => {
      console.log(nanobyteSocket);
      if (!apiKey) {
        reject({
          error: "no_api_key",
          details: "You need to provide an API key",
        });
        return;
      }
      //Check to see if the payment details are valid
      if (!payoutDetails.amount || !payoutDetails.userAddress) {
        reject({
          error: "invalid_payout_details",
          details: "You need to provide an and a user address",
        });
        return;
      }

      if (!nanobyteSocket) {
        console.log("We dont have a websocket connection, creating one");
        // nanobyteSocket = io(NANOBYTE_API_URL + "/wallet-bridge", {
        //   transports: ["websocket"],
        // });

        nanobyteSocket = io("http://localhost:5080/wallet-bridge", {
          withCredentials: true,
          transports: ["websocket", "polling"],
          auth: { username: "", password: "" },
        });

        nanobyteSocket.on("connect_error", (err: any) => {
          // revert to classic upgrade
          console.log(`connect_error due to ${err.message}`);
          nanobyteSocket.io.opts.transports = ["polling", "websocket"];
        });

        console.log(nanobyteSocket);

        nanobyteSocket.on("connect", () => {
          console.log("Send the payment payload");
          nanobyteSocket.emit("payUser", { apiKey, payoutDetails }, (data: any) => {
            resolve(data);
            return;
          });
        });
      } else {
        nanobyteSocket.emit("payUser", { apiKey, payoutDetails }, (data: any) => {
          resolve(data);
          return;
        });
      }
    });
  },
};

export default nanobyte;
