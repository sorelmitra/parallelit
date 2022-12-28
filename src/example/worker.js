console.time('runtime')

const { Command } = require('commander')
const fs = require("fs")
const {parse} = require("@fast-csv/parse")
const {format} = require("@fast-csv/format");
const program = new Command()

const defaultLogInterval = 1000

const getSlice = (source, start, end, header = '') => new Promise(resolve => {
  let i = -2
  const slice = []
  fs.createReadStream(source)
    .pipe(parse())
    .on("error", error => console.error(error))
    .on("data", async row => {
      i++
      if (i === -1) return // skip header row
      if (i < start || i >= end) return // not my slice
      slice.push(row)
    })
    .on("end", (rowCount) => {
      console.timeLog('runtime', `${header}Read slice [${start}, ${end}) from ${source}`)
      resolve(slice)
    })
})

const simulateHardWork = async value => new Promise(resolve => {
  setTimeout(() => {
    resolve(value * 2)
  }, 1000 * Math.random())
})

const doWork = async (number, slice, sliceSource, outputFilepath, logInterval) => {
  logInterval = logInterval ?? defaultLogInterval
  const sliceItems = await getSlice(sliceSource, slice.start, slice.end)
  const stream = format({ headers: ['id', 'value'] })
 	stream.pipe(fs.createWriteStream(outputFilepath))
  const count = sliceItems.length
  for (let i = 0; i < count; i++) {
    const item = sliceItems[i]
    if (i && i % logInterval === 0) {
      console.log(`At item ${i}/${count}...`)
    }
    const doubledInt = await simulateHardWork(item[1])
    stream.write([item[0], doubledInt])
  }
  stream.end()
}

const main = async () => {
  program.command('work')
 		.description(`Work on a slice from a CSV file`)
 		.argument('<slice-source>', 'CSV raw data to where my slice is located')
 		.requiredOption('-n, --number <number>', 'Current worker number, used when creating the output file and when reporting progress')
 		.requiredOption('-s, --start <number>', 'First non-header line number from <slice-source> to process')
    .requiredOption('-e, --end <number>', 'Last non-header line number from <slice-source> to process')
    .requiredOption('-o, --output <filepath>', 'File path where to output the results')
 		.option('-i, --log-interval <number>', 'After how many items to report progress at the console')
 		.action(async (sliceSource, options) => {
 			await doWork(options.number, {start: options.start, end: options.end}, sliceSource, options.output, options.logInterval)
 		})

  await program.parseAsync()
}

main().then(() => console.log('Done.')).catch(e => console.error(e)).finally(() => console.timeEnd('runtime'))
