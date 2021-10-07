require("dotenv").config();

const { WS_RPC } = require('@vite/vitejs-ws');
const { ViteAPI, abi } = require('@vite/vitejs');
const Redis = require("redis");

const CONTRACT_ABI = require("./ABI.json");

const IPFS = require("ipfs-http-client").create(process.env.IPFS_API);
const isIPFS = require('is-ipfs')

const COLLECTION_MINT_TOPIC_ID = abi.encodeLogSignature(CONTRACT_ABI, "onCreateCollection")
const IPFS_PREFIX = "ipfs://";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

let WS_service = new WS_RPC(process.env.VITE_WS);
let provider = new ViteAPI(WS_service, () => {
	console.log("Connected to ViteAPI");
});

console.log(process.env);

async function checkMissedLogs () {
	let last_height = await redis_client.get("last_height");

	console.log("Fetching missed logs, if any, starting from height:", last_height);
	const missed_logs = await provider.request("ledger_getVmLogsByFilter", {
		addressHeightRange: {
			[CONTRACT_ADDRESS]: {
				fromHeight: last_height,
				toHeight: "0"
			}
		}
	});

	await handleLogs(missed_logs);
}

async function handleLogs(logs) {
	if (logs === null) return

	let last_processed_height = null;
	for (let i = 0; i < logs.length; i++) {
		const log = logs[i];
		last_processed_height = log.accountBlockHeight;

		if (log.vmlog.topics.includes(COLLECTION_MINT_TOPIC_ID)) {
			const raw_data = Buffer.from(log.vmlog.data, 'base64').toString('hex');;
			let { baseURI } = abi.decodeLog(CONTRACT_ABI, raw_data, log.vmlog, "onCreateCollection");

			String.startsWith
			// Make sure baseURI doesn't start with "ipfs://"
			if (baseURI.startsWith(IPFS_PREFIX)) {
				baseURI = baseURI.substring(IPFS_PREFIX.length);	
			}

			// Make sure provided CID is valid
			if (isIPFS.cid(baseURI)) {
				IPFS.pin.add(baseURI).then(cid => {
					console.log("Successfully pinned", cid);
				}).catch(err => {
					console.error("Something wrong happened while trying to pin CID:", CID, ", error:", err);
				});
			}
		}
	}

	if (last_processed_height !== null) {
		await redis_client.set("last_height", last_processed_height);
	}
}

let redis_client = null;
async function initializeRedis () {
	redis_client = Redis.createClient({
		host: process.env.REDIS_HOST,
		port: process.env.REDIS_PORT
	});
	redis_client.on("error", (err) => console.log("Redis Client error:", err));

	await redis_client.connect();

	// Setup default values
	const last_height = await redis_client.get("last_height");
	if (last_height === null) {
		await redis_client.set("last_height", "0");
	}
}

async function main () {
	await initializeRedis();

	// Check if we missed any blocks since last run first
	try {
		await checkMissedLogs();
	} catch (err) {
		console.error("Something wrong happened while fetching missed logs:", err);
	}

	try {
		let subscription = await provider.subscribe('createVmlogSubscription', {
			addressHeightRange: {
				[CONTRACT_ADDRESS]: {
					fromHeight: "0",
					toHeight: "0"
				}
			}
		});

		subscription.callback = handleLogs;
	} catch (e) {
		console.log("Something wrong happened listening to new vmlogs:", e)
	}
}

main();