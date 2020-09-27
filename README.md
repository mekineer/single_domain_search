Websites increasingly draw resources from multiple domains.  One example is that of advertising.  Adblockers work because there are domains, or servers, who's sole purpose is to deliver advertising.  Because of the presence of monopolies, a list of domains or servers delivering advertising can be maintained, and their content blocked.  There are other examples where multiple domains are used, and they mostly have to do with the increasing complexity and marketization of the web.  Most importantly, money creates a conflict of interest that reduces the value of the content that the web produces.  See https://lifehacks.science/research-covering-conflicts-of-interest.  Search engines are also affected by this COI.

So where can you search to find a non-marketed web?  You can find it in simplicity: those sites using only a single domain for their resources.  On occasion, these sites may draw resources from other domains, but only to add valuable content, such as an inline youtube video: these resource domains are allowed in a whitelist.  Another reason, for example, is that the site may have a "donate" button from paypal.  The whitelist can be edited, enabled or disabled by the user.

## Please Develop This Project
I'm hoping someone will take over this project, and further develop it, as I am not a programmer.  The current work was done by Gohar Fatima, Abubakar Siddique, and Vikas Kumar through Upwork.  The project description posted on Upwork is the following:

## Original Project Description
Browse a non-corporate web, for websites where all content is delivered by a single domain.
The user script will filter Google search results, to only web pages that use only one domain for their content.  This would take recursive bot-based browsing of all search results, until the desired number of results are listed.

I will be using uBlock Origin on medium mode, to see if a website uses another domain for its content, or scripts, or anything.  For example, Facebook would fail, because it draws from the domain fbcdn.net.  https://mekineer.com/information-technology/2020-ublock-origin-extension

## Current Status
Update: much improved!  Now at about 50%, but the remaining ones that did not filter 100% aren't trash sites, and there are none of the awful sites drawing resources for 10+ domains.

<del>The current status of the development, is that the results returned are too often false positives.  As far as I understand, the false positives are because of 404 and redirection.  Sometimes a site listed in results draws from multiple domains.  There are also fake sites, who's sole purpose is to boost the SEO of a commercialized website.</del>  

<del>I don't get sufficient results from Google in order to further test the script.  This is because Google "throttles" the rate of results delivered using this method.  I am forced to wait an hour or so, and restart the script.  When restarting the script with the same keywords, it starts from the very beginning, retrieving the same results, rather than asking Google to start at the Nth result.  Also, the script doesn't inform me of N, the number of Google search results it has processed for the given keyword search.</del>

We are using Headless Chrome to request search results from Google, and another option would be https://developers.google.com/custom-search/v1/overview (thank you Dino Bartolome).

## Future Possibilities
Currently the project is a python script to test the concept.  Later the project would be a web app.  The web app could be used to build a search database, by providing a portal for users to search a search engine, like Google.

Is it possible for a visitor to the portal site, to present to Google their own IP address, instead of the portal site's IP address?
Is it also possible, for the portal to access the search result, so that it can use the results to build a search database?
Answer: "This can be done with Google's Custom Search javascript, in which case the end-user's web browser will be making the request, and not the OP's server." source: https://www.daniweb.com/programming/web-development/threads/523733/portal-to-search-engine

The user's IP address, or any of the user's information, would not be kept. The database would be used to filter results in ways that Google's search syntax is not capable of filtering. These filtered results would be served to the user, alongside Google's results.

Aside from listing sites that draw only from a single domain, sans whitelist, the possibilities could be much greater.  Blacklists in use by ad-blockers could be used.  It could also be useful for showing the ways that Google returns different results depending on the country you are in, the web browser you are using, your logged in status, etc.

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
