const { Command } = require('commander')
const fs = require("fs")
const {format} = require("@fast-csv/format")
const program = new Command()

const gather = async (outputFilepath) => {
  const stream = format({ headers: ['id', 'value'] })
 	stream.pipe(fs.createWriteStream(outputFilepath))
  for (let i = 1; i < 164; i++) {
    const randomNumber = i + Math.floor(Math.random() + 20)
    stream.write([i, randomNumber])
  }
  stream.end()
}

const main = async () => {
  program
    .description(`Gather raw data for parallel processing`)
    .argument('<output-filepath>', 'CSV raw data to where to put gathered raw data')
 		.action(async (outputFilepath) => {
 			await gather(outputFilepath)
 		})

  await program.parseAsync()
}

main().then(() => console.log('Done.')).catch(e => console.error(e))
