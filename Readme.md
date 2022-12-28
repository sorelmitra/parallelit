# Overview

This is a simple Node.JS tool that allows processing arbitrary data in parallel, using Node.JS fork, in two steps:

- Step 1: Synchronously call a single Node.JS file that will gather the raw data to process.  Result: a CSV file with data to process in parallel.

- Step 2: Split the CSV file from Step 1 into N slices.  Feed each slice to a worker, which is
        another Node.JS file.  Spin up N workers and wait for them to finish.  Report results.

# Quick Start

## If Gathering the Raw Data is Quick

Copy `src/example/gatherer.js` and implement the `gather()` function to write the CSV file with the raw data.

Copy `src/example/worker.js` and implement the `doWork(number, slice, sliceSource, outputFilepath, logInterval)` function to:

- Read its `slice` of the form `{start: 0, end: 40}` from `sliceSource` CSV file
- Process each element from the slice
- Report progress in the form `At item i/N...`, after `logInterval` items

Run the parallel tool like:

```shell
node src/index.js run -c <workers-count> -g <path>/my-gatherer.js -w <path>/my-worker.js -i <log-interval>
```

## If Gathering the Raw Data is Lengthy

If gathering this data is a lengthy process, then implement the gatherer as a worker that you run separately, and run this in two stages.

### Stage 1: Gather data in parallel

Run:

```shell
node src/index.js run -c <workers-count> -w <path>/my-gatherer.js -i <log-interval>
```

Then rename `output/OUT.csv` to `output/STEP1.csv`.

### Stage 2: Process gathered data

```shell
node src/index.js run -c <workers-count> -w <path>/my-worker.js -i <log-interval>
```

# Reference

Run like:

```shell
node index.js [--gatherer `gather-raw-data-JS`] --count `workersCount` --worker `worker-JS`
```

Where:

* `workersCount` is the number of parallel workers that will be spawned.

* `gather-raw-data-JS` is the Node.JS file that will produce the CSV with raw data,
  which will be split into `workersCount` slices.  It will be called with a single parameter: `output-file-path.csv`, which is a CSV file where the program will write the data to be
        processed in parallel, with the first line containing the header row.  Example:
        
        id,name,email
        1,Doe,doe@foo.bar
        2,Pic,pic@foo.bar
  
  If gathering data is slow, you could spin up other workers instead, and skip this
  parameter.  Then run the script again to process the gathered data.

* `worker-JS` is the worker Node.JS file what will be called for each slice, and must
  produce a result file with its progress.  It will be called with the following parameters: `-n <worker-number> -s <slice-start> -e <slice-end> -i <report-interval> <slice-source>`, where:
  
  - `worker-number` is the unique number assigned to this worker
  - `slice-source` is the CSV raw data file gathered above, of which the slices are made
  - `slice-start` is the first non-header line number to process in that CSV file
  - `slice-end` is the last non-header line number to process in that CSV file
  - `report-interval` is the after how many items to report progress at the console.
    - Reporting progress is best done in a very few concise lines, and at least one.
    - Using in-line reporting such as dots with no new-line added is not recommended, because
    - the output would become useless due to the amount of workers sharing it.

NOTE: I also attempted to do this with just NodeJS promises, based on the fact that
requests are made in parallel by the Node engine.  It does run in parallel, but
much slower than in the fork version.  Thus, this tool was born.
