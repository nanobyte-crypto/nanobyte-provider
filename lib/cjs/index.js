"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const socket_io_client_1 = require("socket.io-client");
const axios_1 = __importDefault(require("axios"));
let NANOBYTE_API_URL = process.env.NANOBYTE_PROVIDER_URL || "https://api.nanobytepay.com";
let nanobyteSocket;
let sessionKey;
let isConnecting = false; // Prevent multiple connections
let isPaying = false; // Prevent multiple payments
const getWebSocketConnection = () => __awaiter(void 0, void 0, void 0, function* () {
    return new Promise((resolve, reject) => {
        if (!!nanobyteSocket && nanobyteSocket.connected) {
            resolve(nanobyteSocket);
        }
        else {
            nanobyteSocket = (0, socket_io_client_1.io)(NANOBYTE_API_URL + "/wallet-bridge", {
                transports: ["websocket"],
            });
            nanobyteSocket.on("connect", () => {
                resolve(nanobyteSocket);
            });
        }
    });
});
//Manage login data in local storage
const storeLoginData = (apiKey, data) => {
    const loginData = JSON.stringify(data);
    localStorage.setItem(apiKey, loginData);
};
const removeLoginData = (apiKey) => {
    localStorage.removeItem(apiKey);
};
const retrieveLoginData = (apiKey) => {
    const loginData = localStorage.getItem(apiKey);
    if (loginData) {
        return JSON.parse(loginData);
    }
};
const nanobyte = {
    // Here we connect to the nanobyte socket and authenticate the user and establish a session
    connect: (apiKey) => {
        return new Promise((resolve, reject) => __awaiter(void 0, void 0, void 0, function* () {
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
            const socket = yield getWebSocketConnection();
            //Begin authentication
            socket.emit("initConnection", { apiKey }, (data) => {
                if (data.error) {
                    reject(data);
                    return;
                }
                //We get a nonce back from the server that the user needs to sign
                const { merchantName, nonce } = data;
                sessionKey = data.sessionKey;
                let request = {
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
            socket.on("connectionCompleted", (data) => __awaiter(void 0, void 0, void 0, function* () {
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
            }));
            //We listen for the response from the server if the user cancels the authentication
            socket.on("connectionCancelled", (data) => __awaiter(void 0, void 0, void 0, function* () {
                // send the cancelled status back to the merchant
                resetConnectionFlag();
                reject({
                    error: "auth_cancelled",
                    details: "User cancelled authentication",
                });
                return;
            }));
        }));
    },
    onDisconnect(apiKey, callback) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!apiKey) {
                return {
                    error: "no_api_key",
                    details: "You need to provide an API key",
                };
            }
            // connect to nanobyte socket:
            const socket = yield getWebSocketConnection();
            socket.on("walletDisconnected", () => {
                removeLoginData(apiKey);
                callback({ status: "disconnected" });
                socket.close();
                return;
            });
        });
    },
    onBalanceUpdate(sessionKey, callback) {
        return __awaiter(this, void 0, void 0, function* () {
            console.log("onBalanceUpdate");
            if (!sessionKey) {
                console.log("no_session_key");
                return {
                    error: "no_session_key",
                    details: "You need to provide a session key",
                };
            }
            // connect to nanobyte socket:
            const socket = yield getWebSocketConnection();
            //Get initial balance
            socket.emit("getBalance", { sessionKey }, (data) => {
                console.log("we have manually asked for the balance");
                callback(data.balance);
            });
            socket.on("balanceUpdate", (data) => {
                console.log("we are getting the balance back");
                callback(data.balance);
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
            axios_1.default
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
        return new Promise((resolve, reject) => __awaiter(void 0, void 0, void 0, function* () {
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
            const socket = yield getWebSocketConnection();
            socket.emit("checkConnection", { sessionKey: loginData.sessionKey }, (data) => {
                if (!!data.connected) {
                    let response = {
                        connected: data.connected,
                        connectionData: loginData,
                    };
                    resolve(response);
                }
                else {
                    removeLoginData(apiKey);
                    resolve({
                        connected: false,
                    });
                }
                return;
            });
            //If we have a websocket connection, check if it's the wallet is connected to the session
        }));
    },
    // Disconnect the user from the session
    disconnect(apiKey, sessionKey) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
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
                const socket = yield getWebSocketConnection();
                socket.emit("disconnectWallet", { sessionKey });
                removeLoginData(apiKey);
                socket.close();
                resolve({ status: "disconnected" });
                return;
            }));
        });
    },
    // Request a payment from the user
    requestPayment: (apiKey, sessionKey, paymentDetails) => {
        return new Promise((resolve, reject) => __awaiter(void 0, void 0, void 0, function* () {
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
            if (!paymentDetails.price ||
                !paymentDetails.label ||
                !paymentDetails.currency) {
                reject({
                    error: "invalid_payment_details",
                    details: "You need to provide a price, label and currency",
                });
                return;
            }
            // Check to see if we are already connecting
            if (!!isPaying) {
                reject({
                    error: "payment_in_progress",
                    details: "There is already a payment in progress",
                });
                return;
            }
            // Reset the flag when the payment is completed or cancelled
            const resetPayingFlag = () => {
                isPaying = false;
            };
            isPaying = true;
            const socket = yield getWebSocketConnection();
            const { price, label, message, metadata } = paymentDetails;
            const currency = paymentDetails.currency.toUpperCase();
            let amount;
            let amountRequestData = {
                price,
                currency,
            };
            //We need to get the payment amount in RAW from the server
            socket.emit("requestAmount", amountRequestData, (data) => __awaiter(void 0, void 0, void 0, function* () {
                if (data.error) {
                    resetPayingFlag();
                    reject(data);
                    return;
                }
                //We get the amount back and build the request for the wallet
                amount = data.amount;
                let request = {
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
                    metadata: Object.assign(Object.assign({}, paymentDetails === null || paymentDetails === void 0 ? void 0 : paymentDetails.metadata), { merchantApiKey: apiKey, price: price, currency: currency, sessionKey: sessionKey }),
                };
                //Send the request to the wallet
                socket.emit("initPayment", request, (data) => {
                    if (!!data.error) {
                        resetPayingFlag();
                        reject(data);
                        return;
                    }
                });
            }));
            //subscribe to payment results:
            socket.on("paymentResults", (data) => {
                var _a;
                // send the payment status back to the merchant
                //build the response
                let response = {
                    paymentId: data.paymentId,
                    paymentStatus: data.paymentStatus,
                };
                if (!!((_a = data === null || data === void 0 ? void 0 : data.metadata) === null || _a === void 0 ? void 0 : _a.paymentHash)) {
                    response.paymentHash = data.metadata.paymentHash;
                }
                resetPayingFlag();
                resolve(response);
                return;
            });
        }));
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
            axios_1.default
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
    getPayoutAddressDetails(apiKey) {
        //Create the socket connection if it doesn't exist
        return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
            if (!apiKey) {
                reject({
                    error: "no_api_key",
                    details: "You need to provide an API key",
                });
                return;
            }
            const socket = yield getWebSocketConnection();
            socket.emit("requestPayoutAddressDetails", { apiKey }, (data) => {
                if (data.error) {
                    reject(data);
                    return;
                }
                resolve(data);
                return;
            });
        }));
    },
    payoutUser(apiKey, secretKey, sessionKey, amount) {
        return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
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
            const socket = yield getWebSocketConnection();
            socket.emit("payoutUser", { apiKey, secretKey, sessionKey, amount }, (data) => {
                resolve(data);
                return;
            });
        }));
    },
};
exports.default = nanobyte;
