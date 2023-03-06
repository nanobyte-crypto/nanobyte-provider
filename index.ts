interface NanobyteProvider {
  connect: (apiKey: string) => Promise<{
    status: string;
    account?: string;
    balance?: string;
    nonce?: string;
    signature?: string;
  }>;
  // Add more methods and properties as needed
  requestPayment: (
    apiKey: string,
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
    amount: string;
    paymentId: string;
    paymentStatus: string;
    paymentHash: string;
  }>;
  getAccountBalance: (apiKey: string) => Promise<string>;
  isConnected: (apiKey: string) => Promise<{
    isConnected: boolean;
    connectionData?: {
      account: string;
      balance: string;
    };
  }>;
  disconnect: (apiKey: string) => void;
}

interface Window {
  nanobyte?: NanobyteProvider;
}

export default detectNanobyteProvider;

/**
 * Returns a Promise that resolves to the value of window.nanobyte if it is
 * set within the given timeout, or null.
 * The Promise will not reject, but an error will be thrown if invalid options
 * are provided.
 *
 * @param options - Options bag.
 * @param options.silent - Whether to silence console errors. Does not affect
 * thrown errors. Default: false
 * @param options.timeout - Milliseconds to wait for 'nanobyte#initialized' to
 * be dispatched. Default: 3000
 * @returns A Promise that resolves with the Provider if it is detected within
 * given timeout, otherwise null.
 */
function detectNanobyteProvider<T = NanobyteProvider>({ silent = false, timeout = 3000 } = {}): Promise<T | null> {
  _validateInputs();

  let handled = false;

  return new Promise((resolve) => {
    if ((window as Window).nanobyte) {
      handleNanobyte();
    } else {
      window.addEventListener("nanobyte#initialized", handleNanobyte, { once: true });

      setTimeout(() => {
        handleNanobyte();
      }, timeout);
    }

    function handleNanobyte() {
      if (handled) {
        return;
      }
      handled = true;

      window.removeEventListener("nanobyte#initialized", handleNanobyte);

      const { nanobyte } = window as Window;

      if (nanobyte) {
        resolve(nanobyte as unknown as T);
      } else {
        const message = "Unable to detect window.nanobyte.";
        !silent && console.error("@nanobyte-crypto/nanobyte-provider", message);
        resolve(null);
      }
    }
  });

  function _validateInputs() {
    if (typeof silent !== "boolean") {
      throw new Error(`@nanobyte-crypto/nanobyte-provider: Expected option 'silent' to be a boolean.`);
    }
    if (typeof timeout !== "number") {
      throw new Error(`@nanobyte-crypto/nanobyte-provider: Expected option 'timeout' to be a number.`);
    }
  }
}
