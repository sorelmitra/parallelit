console.time('runtime')

process.env = {
	...process.env,
	AWS_SDK_LOAD_CONFIG: true,
	AWS_PROFILE: `${process.env.ENV}-profile`,
	AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1'
}
const fs = require('fs')
const { format } = require('@fast-csv/format')
const { parse } = require('@fast-csv/parse')
const { fork} = require('child_process')
const { Command } = require('commander')
const program = new Command()

let step2LogInterval = 1000

const step1Filename = "./output/STEP1.csv"
const step2AllFilename = "./output/OUT.csv"
const getStep2Filename = number => `./output/STEP2-WORKER-${number}-OUT.csv`

const controllers = []

const exitHandler = (options, exitCode = 0) => {
	for (const c of controllers) {
		if (c) c.abort()
	}
	console.timeEnd("runtime");
	if (options.exit) process.exit(exitCode)
}

process.on('exit', exitHandler.bind(null, { exit: true }));
process.on('SIGINT', exitHandler.bind(null, { exit: true }));

const gatherRawData = async gathererFilepath => {
	const p = new Promise((resolve, reject) => {
		const child = fork(gathererFilepath, [step1Filename], {silent: true})
		child.stdout.on('data', (data) => {
		  process.stdout.write(`[Gatherer] ${data}`)
		})
		child.stderr.on('data', (data) => {
		  process.stderr.write(`[Gatherer] [ERROR] ${data}`)
		})
		child.on('close', (code) => {
			console.log(`[Gatherer] child process exited with code ${code}`)
			resolve()
		})
		child.on('error', err => reject(err))
	})
	await p
}

const getStep1ItemsCount = async () => new Promise(resolve => {
	fs.createReadStream(step1Filename)
		.pipe(parse())
		.on("error", error => console.error(error))
		.on('data', () => {
		})
		.on("end", (rowCount) => {
			let itemCount = rowCount - 1 // skip header row
			console.log(`${itemCount} items from step 1`)
			resolve(itemCount)
		})
});

const getSlices = (itemsCount, workersCount) => {
	const size = Math.floor(itemsCount / workersCount)
	const slices = []
	let start = 0
	let end = 0
	for (let i = 0; i < workersCount - 1; i++) {
		end = start + size
		slices.push({ start, end })
		start = end
	}
	slices.push({ start, end: itemsCount + 1 })
	console.log('Slices for workers', slices)
	return slices
}

const getWorkerResults = async (number, itemSlice) => new Promise(resolve => {
	let i = -1
	const results = []
	fs.createReadStream(getStep2Filename(number))
		.pipe(parse())
		.on("error", error => console.error(error))
		.on("data", async row => {
			if (row.includes('id')) return // skip header row
			i++
			results.push(row)
		})
		.on("end", (rowCount) => {
			resolve(results)
		})
});

const gatherAllResults = async slices => {
	const stream = format({ headers: ['id', 'value'] });
	stream.pipe(fs.createWriteStream(step2AllFilename));
	for (let i = 0; i < slices.length; i++) {
		const results = await getWorkerResults(i + 1);
		for (const result of results) {
			stream.write(result)
		}
	}
	stream.end();
};

const startAWorker = (workerFilepath, workerIndex, slice, timeout) => new Promise(resolve => {
	const number = workerIndex + 1
	controllers[workerIndex] = new AbortController()
	const {signal} = controllers[workerIndex]
	let child
	setTimeout(() => {
		child = fork(
			workerFilepath,
			[
				'work',
				'-n', number,
				'-s', slice.start, '-e', slice.end,
				'-o', getStep2Filename(number),
				'-i', step2LogInterval,
				step1Filename
			],
			{signal, silent: true}
		)
		child.stdout.on('data', (data) => {
		  process.stdout.write(`[Worker ${number}] ${data}`)
		})
		child.stderr.on('data', (data) => {
		  process.stderr.write(`[Worker ${number}] [ERROR] ${data}`)
		})
		child.on('close', (code) => {
			console.log(`[Worker ${number}] child process exited with code ${code}`);
			resolve()
		})
	}, timeout)
})

const startWorkers = async (workersCount, workerFilepath) => {
	const n = await getStep1ItemsCount()

	const slices = getSlices(n, workersCount)
	const children = []
	for (let i = 0; i < slices.length; i++) {
		const slice = slices[i];
		children[i] = startAWorker(workerFilepath, i, slice, 2000 * i)
	}
	await Promise.all(children)
	await gatherAllResults(slices)
	console.log(`All ${children.length} children have finished`)
}

const main = async () => {
	program
		.name('parallelit')
		.version('1.0.0')
		.description(`
Process arbitrary data in parallel, using Node.JS fork, in two steps:

Step 1: Synchronously call a single Node.JS file that will gather the raw data to process.
        Result: a CSV file with data to process in parallel.

Step 2: Split the CSV file from Step 1 into N slices.  Feed each slice to a worker, which is
        another Node.JS file.  Spin up N workers and wait for them to finish.  Report results.

Example run:

node src/index.js run -c 4 -g src/example/gatherer.js -w src/example/worker.js -i 10

Run like:

node index.js [--gatherer <gather-raw-data-JS>] --count <workersCount> --worker <worker-JS>

Where:

* <workersCount> is the number of parallel workers that will be spawned.

* <gather-raw-data-JS> is the Node.JS file that will produce the CSV with raw data,
  which will be split into <workersCount> slices.  It will be called with:
  
  <gather-raw-data-JS> <output-file-path.csv>, where:
  
      - <output-file-path.csv> is a CSV file where the program will write the data to be
        processed in parallel, with the first line containing the header row.  Example:
        
        id,name,email
        1,Doe,doe@foo.bar
        2,Pic,pic@foo.bar
  
  If gathering data is slow, you could spin up other workers instead, and skip this
  parameter.  Then run the script again to process the gathered data.

* <worker-JS> is the worker Node.JS file what will be called for each slice, and must
  produce a result file with its progress.  It will be called with:
  
  <worker-JS> -n <worker-number> -s <slice-start> -e <slice-end> -i <report-interval> <slice-source>,
  where:
  
      - <worker-number> is the unique number assigned to this worker
      - <slice-source> is the CSV raw data file gathered above, of which the slices are made
      - <slice-start> is the first non-header line number to process in that CSV file
      - <slice-end> is the last non-header line number to process in that CSV file
      - <report-interval> is the after how many items to report progress at the console.
        Reporting progress is best done in a very few concise lines, and at least one.
        Using in-line reporting such as dots with no new-line added is not recommended, because
        the output would become useless due to the amount of workers sharing it.

NOTE: I also attempted to do this with just NodeJS promises, based on the fact that
requests are made in parallel by the Node engine.  It does run in parallel, but
much slower than in the fork version.  Thus, this tool was born.
  `)

	program.command('run')
		.description('Run parallel workers on slices of data')
		.requiredOption('-c, --count <number>', `Number of parallel workers to be spawned`, '1')
		.requiredOption('-w, --worker <file path>', 'Path to the Node.JS worker file')
		.option('-g, --gatherer <file path>', "Path to the Node.JS gatherer file.  If not specified, it will not gather data, and will assume it's been already gathered")
		.option('-i, --log-interval <number>', 'Number of loans after which to log status')
		.action(async (options) => {
			if (options.logInterval) step2LogInterval = options.logInterval
			try {
				if (options.gatherer) await gatherRawData(options.gatherer)
				await startWorkers(options.count, options.worker)
			} catch (e) {
				console.error(e)
			}
		})

	await program.parseAsync()
}

main().then(() => console.log('Done.')).catch(e => console.error(e)).finally(() => console.timeEnd('runtime'))
