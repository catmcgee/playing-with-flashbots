const { JsonRpcProvider, Wallet, ethers } = require('ethers');
const {
    FlashbotsBundleProvider,
    FlashbotsBundleResolution
} = require('@flashbots/ethers-provider-bundle');
const { exit } = require('process');
require('dotenv').config();

const FLASHBOTS_URL = "https://relay.flashbots.net";
const RECEIVER_ADDRESS = "0x62f4F40043D67a12febe79E3868237FE11b87251";  

const NFTs = [
  { contractAddress: "0x8d0802559775C70fb505f22988a4FD4A4f6D3B62", tokenIds: [9693, 9661, 9445] },
  { contractAddress: "0xC3A314dBcE1A2D86Fd974238529e4D2784De11b5", tokenIds: [18] },
  { contractAddress: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85", tokenIds: [BigInt("44345741729242902331877186582625108662744868218298972493141527835479300933818")] },
  { contractAddress: "0x9D90669665607F08005CAe4A7098143f554c59EF", tokenIds: [160516] },
  { contractAddress: "0x25ed58c027921E14D86380eA2646E3a1B5C55A8b", tokenIds: [2720] },
  { contractAddress: "0x495f947276749Ce646f68AC8c248420045cb7b5e", tokenIds: [BigInt("79063567087551997350998521341699779892441081020608625409344522844864463765505")] },
  { contractAddress: "0x6aC459c3C83947ef94b6af1123a8162FE480D419", tokenIds: [2656] },
  { contractAddress: "0x0000000000664ceffed39244a8312bD895470803", tokenIds: [282943] }
];

const main = async () => {
  if (!process.env.SPONSOR_KEY || !process.env.COMPROMISED_KEY) {
    console.error("Please set both SPONSOR_KEY and COMPROMISED_KEY env");
    exit(1);
  }

  const provider = new ethers.JsonRpcProvider("https://mainnet.infura.io/v3/22e761277dba4c16a70153908fa5de13");
  const authSigner = ethers.Wallet.createRandom();
  const flashbotsProvider = await FlashbotsBundleProvider.create(provider, authSigner, FLASHBOTS_URL);

  const sponsor = new ethers.Wallet(process.env.SPONSOR_KEY).connect(provider);
  const compromised = new ethers.Wallet(process.env.COMPROMISED_KEY).connect(provider);

  const getCompromisedNonce = async () => {
    const nonce = await compromised.getNonce();
    console.log(`Compromised nonce: ${nonce}`);
    return nonce;
  };

  provider.on("block", async (blockNumber) => {
  console.log(`Current Block: ${blockNumber}`);
  const targetBlockNumber = blockNumber + 1;

  let compromisedNonce = await getCompromisedNonce();

  const transactions = NFTs.flatMap((nft) =>
    nft.tokenIds.map(tokenId => {
      const transactionData = new ethers.Interface(["function safeTransferFrom(address from, address to, uint256 tokenId)"])
        .encodeFunctionData("safeTransferFrom", [
          compromised.address,
          RECEIVER_ADDRESS,
          BigInt(tokenId)
        ]);

      return {
        signer: compromised,
        transaction: {
          chainId: 1,
          type: 2,
          to: nft.contractAddress,
          gasLimit: "50000",
          data: transactionData,
          maxFeePerGas: ethers.parseUnits("100", "gwei"),
          maxPriorityFeePerGas: ethers.parseUnits("50", "gwei"), 
          nonce: compromisedNonce++
        }
      };
    })
  );

  const sponsorNonce = await sponsor.getNonce();

  const sponsorTransaction = {
    signer: sponsor,
    transaction: {
      chainId: 1,
      type: 2,
      to: compromised.address,
      value: ethers.parseEther("0.04"), 
      maxFeePerGas: ethers.parseUnits("100", "gwei"),
      maxPriorityFeePerGas: ethers.parseUnits("50", "gwei"),
      nonce: sponsorNonce
    },
  };

  const signedTransactions = await flashbotsProvider.signBundle([
    sponsorTransaction,
    ...transactions
  ]);

  console.log("Signed transactions:", signedTransactions);

  const simulation = await flashbotsProvider.simulate(signedTransactions, targetBlockNumber);
  if ("error" in simulation) {
    console.error(`Simulation error: ${simulation.error.message}`);
    return;
  }

  console.log("Simulation successful. Sending bundle.");

  const resp = await flashbotsProvider.sendBundle(
    [sponsorTransaction, ...transactions],
    targetBlockNumber
  );

  console.log("Bundle response:", resp);

  if ("error" in resp) {
    console.error(`Error sending bundle: ${resp.error.message}`);
    return;
  }

  console.log(`Bundle sent, waiting for inclusion in block ${targetBlockNumber}`);
  const resolution = await resp.wait();
  console.log("Resolution:", resolution);
  if (resolution === FlashbotsBundleResolution.BundleIncluded) {
    console.log(`Success: Bundle included in block ${targetBlockNumber}`);
    exit(0);
  } else if (resolution === FlashbotsBundleResolution.BlockPassedWithoutInclusion) {
    console.log(`Warning: Bundle not included in block ${targetBlockNumber}`);
  } else if (resolution === FlashbotsBundleResolution.AccountNonceTooHigh) {
    console.error("Error: Nonce too high, exiting");
    exit(1);
  } else {
    console.error(`Unexpected resolution: ${resolution}`);
  }
});
};

main()