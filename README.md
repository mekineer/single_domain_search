I'm hoping someone will take over this project, and further develop it.  I'm not a programmer, and the current work was done by Gohar Fatima through Upwork.  It started as a fixed price contract, but she kept wanting more milestone payments, and this was over my budget.  She does good work, but it's more than I intended on funding.  The project description posted on Upwork is the following:

<project>
Browse a non-corporate web, for websites where all content is delivered by a single domain.
The user script will filter Google search results, to only web pages that use only one domain for their content.  This would take recursive bot-based browsing of all search results, until the desired number of results are listed.

I will be using uBlock Origin on medium mode, to see if a website uses another domain for its content, or scripts, or anything.  For example, Facebook would fail, because it draws from the domain fbcdn.net.  https://mekineer.com/information-technology/2020-ublock-origin-extension
</project>

The current status of the development, is that the results returned are too often false positives.  As far as I understand, the false positives are because of 404 and redirection.  Sometimes the resulting site draws from multiple domains.

## PRE-REQ
Please download following before running the script.
1. Python3.8
1. Chrome Browser
1. Selenium Chrome Webdriver

## Updating the param.json
Before running the script you can update params as below,
1. **desired_count**: Number of urls you wish to find.
1. **query**: String that will be searched on Google.
1. **batch_limit**: Urls limit to fetch on each Google call.
1. **pause_delay**: Delay period between each batch; increase this to avoid Google throtlling.
1. **output_csv**: path to output csv. This will append if file already exists.
1. **whitelist**: Array of domains to be whitelisted.
1. **save_htmls**: Boolean value, to save page sources in htmls directory.
1. **page_delay**: Delay in seconds to wait for a page to load. Should be greater than 1.


OPTIONAL PARAMS:
1. **min_date**: Search from this date.
1. **max_date**: Search uptil this date.
1. **tld**: Top Level Domain to search in.
1. **lang**: language to search in.
1. **safe**: safe browsing filter.
1. **country**: Country to search in.

## Running the script
Next, you’ll need to run bash file. Follow these steps
1. ```cd single_cdn```
2. ```sh mac_run.sh```

## Output of script
Following logs will be generated.
1. **scdn.log**: script logs.
1. **server.log**: browsermap server logs.
1. **bmp.log**: browsermap client logs.
