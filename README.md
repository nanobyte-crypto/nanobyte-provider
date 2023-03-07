# Nanobyte Provider

A small utility that enables you to detect the presence of Nanobyte through the injected `window.nanobyte`. 

`window.nanobyte` provides a simple API for authenticating users, and requesting payments through Nanobyte.

## Installation

Using npm:

```npm install @nanobyte-crypto/nanobyte-provider```

Using Yarn:

```yarn add @nanobyte-crypto/nanobyte-provider```


## Usage

```
import detectNanobyteProvider from "@nanobyte-crypto/provider";

const nanobyte = await detectNanobyteProvider();

if(nanobyte) {

    console.log('Nanobyte successfully detected!')

    //Now you can authenticate the user and request payments

    //Before you can request a payment you need to connect to the users account
    const connected = await nanobyte.connect('your-api-key');

    //Request a payment
    const payment = await nanobyteProvider.requestPayment('your-api-key', {
        price: '500',
        currency: 'NANO',
        label: 'The Holy Hand Grenade of Antioch',
        message: 'One, two, five!',
        metadata: {
            // custom metadata fields
            orderId: "45621"
            origin: "Saint Attila"
            customerName: "Brother Maynard"
            },
        });

} else {
  // if the nanobyte provider is not detected, it means the user doesnt have 
  console.error('Please install MetaMask!', error)
}


```





