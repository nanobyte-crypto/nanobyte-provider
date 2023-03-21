# Nanobyte Provider API

Nanobyte is a versatile and powerful payment processor, designed to facilitate seamless transactions on the [Nano](https://nano.org) network. Built on top of the Nano protocol, Nanobyte is user-friendly and easy to integrate into your application.

For extensive documentation on how to use this package, please refer to the [Nanobyte Provider API Documentation](https://nanobytepay.com/docs).

Installation
To install the Nanobyte Provider API package, you can use npm:

```bash
npm install nanobyte-provider
```

Usage
To use the Nanobyte Provider API package in your project, you can import it and create a new instance of the NanobyteProvider interface, passing in your API key:

```javascript
import nanobyte from "nanobyte-provider";

//Connecting to a user wallet

nanobyte
  .connect("<your-api-key>")
  .then((data) => {
    //save the data.sessionKey for future interactions
    //Handle the connection data
    console.log(data);
    const connectedData = {
      nonce: data.nonce,
      signature: data.signature,
      status: data.status,
      account: data.account,
      sessionKey: data.sessionKey,
    };
  })
  .catch((error) => {
    //Handle the error
    console.error(error);
  });
```

You can use the methods exposed by the Nanobyte Provider API interface to send and receive payments.

### Methods

`connect(apiKey: string) => Promise`

Connect to the Nanobyte payment gateway and retrieve authentication data.

`onDisconnect: (apiKey: string, callback: (data: any) => void) => void;`

Connect to the Nanobyte payment gateway and retrieve authentication data.

`verifyAuth(apiKey: string, nonce: string) => Promise`

Verify the authentication data retrieved from the connect() method.

`isConnected(apiKey: string) => Promise`

Check whether the current session is still connected to the Nanobyte payment gateway.

`disconnect(apiKey: string, sessionKey: string) => Promise`

Disconnect the current session from the Nanobyte payment gateway.

`requestPayment(apiKey: string, sessionKey: string, paymentDetails: object) => Promise`

Request a payment from the Nanobyte payment gateway.

`verifyPayment(apiKey: string, paymentId: string) => Promise`

Verify the status of a payment requested from the Nanobyte payment gateway.

`getUserAccountBalance(sessionKey: string) => Promise`

Retrieve the current balance of the user's account.

`getPayoutAddressDetails(apiKey: string) => Promise`

Retrieve the payout address and balance associated with the current session.

`payoutUser(apiKey: string, sessionKey: string, amount: string) => Promise`

Initiate a payout to the user's payout address.

License
This package is distributed under the MIT License. See LICENSE for more information.
