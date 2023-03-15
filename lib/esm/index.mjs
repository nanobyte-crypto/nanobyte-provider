import { io } from "socket.io-client";
let NANOBYTE_API_URL = process.env.PROVIDER_URL || "https://api.nanobytepay.com";
let nanobyteSocket;
let sessionKey;
let isConnecting = false; // Prevent multiple connections
const getWebSocketConnection = async () => {
    return new Promise((resolve, reject) => {
        console.log(nanobyteSocket);
        if (!!nanobyteSocket && nanobyteSocket.connected) {
            resolve(nanobyteSocket);
        }
        else {
            nanobyteSocket = io(NANOBYTE_API_URL + "/wallet-bridge", {
                transports: ["websocket"],
            });
            nanobyteSocket.on("connect", () => {
                resolve(nanobyteSocket);
            });
        }
    });
};
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
    test: () => {
        console.log("test");
    },
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
            const socket = await getWebSocketConnection();
            console.log(`Connecting to nanobyte socket: ${socket.id}...`);
            console.log(`initConnection with apiKey: ${apiKey}...`);
            //Begin authentication
            socket.emit("initConnection", { apiKey }, (data) => {
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
                                storeLoginData(apiKey, data);
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
                        resetConnectionFlag();
                    }
                    return;
                })
                    .catch((error) => {
                    console.error(error);
                });
            });
            //We listen for the response from the server after it has verified the signature
            socket.on("connectionCompleted", async (data) => {
                if (data.status === "rejected") {
                    // send the rejected status back to the merchant if the signature is invalid
                    console.log(`calling resetConnectionFlag()... from socket on connectionCompleted`);
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
                resolve(data);
                return;
            });
            //We listen for the response from the server if the user cancels the authentication
            socket.on("connectionCancelled", async (data) => {
                // send the cancelled status back to the merchant
                console.log(`calling resetConnectionFlag()... from socket on connectionCancelled`);
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
                reject(error);
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
            const socket = await getWebSocketConnection();
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
                    reject({
                        error: "not_connected",
                        details: "You are not connected to a wallet",
                    });
                }
                return;
            });
            //If we have a websocket connection, check if it's the wallet is connected to the session
        });
    },
    // Disconnect the user from the session
    async disconnect(apiKey, sessionKey) {
        const socket = await getWebSocketConnection();
        socket.emit("disconnectWallet", { sessionKey });
        removeLoginData(apiKey);
        socket.close();
        return { status: "disconnected" };
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
            const socket = await getWebSocketConnection();
            const { price, label, message, metadata } = paymentDetails;
            const currency = paymentDetails.currency.toUpperCase();
            let amount;
            let amountRequestData = {
                price,
                currency,
            };
            //We need to get the payment amount in RAW from the server
            socket.emit("getAmount", amountRequestData, async (data) => {
                if (data.error) {
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
                    metadata: {
                        ...paymentDetails?.metadata,
                        merchantApiKey: apiKey,
                        price: price,
                        currency: currency,
                        sessionKey: sessionKey,
                    },
                };
                //Send the request to the wallet
                socket.emit("initPayment", request, (data) => {
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
                            let response = {
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
            socket.on("paymentResults", (data) => {
                // send the payment status back to the merchant
                //build the response
                let response = {
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
                    resolve(data);
                    return;
                }
            })
                .catch((error) => {
                reject(error);
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
            const socket = await getWebSocketConnection();
            socket.emit("requestAccountBalance", { sessionKey });
            socket.on("accountBalance", (data) => {
                resolve(data);
                return;
            });
        });
    },
    getMerchantAccountBalance(apiKey) {
        //Create the socket connection if it doesn't exist
        return new Promise(async (resolve, reject) => {
            const socket = await getWebSocketConnection();
            socket.emit("requestMerchantAccountBalance", { apiKey }, (data) => {
                resolve(data);
                return;
            });
        });
    },
    payUser(apiKey, payoutDetails) {
        return new Promise(async (resolve, reject) => {
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
            const socket = await getWebSocketConnection();
            socket.emit("payUser", { apiKey, payoutDetails }, (data) => {
                resolve(data);
                return;
            });
        });
    },
};
export default nanobyte;
